<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\Api\ForbiddenException;
use App\Exceptions\Api\NotFoundException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Service\StoreServiceRequest;
use App\Http\Requests\Service\UpdateServiceRequest;
use App\Http\Resources\ServicePhotoResource;
use App\Http\Resources\ServiceResource;
use App\Models\Booking;
use App\Models\Service;
use App\Services\ServiceService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class ServiceController extends Controller
{
    public function __construct(private readonly ServiceService $service) {}

    /** GET /services — public browse, optional ?category_id filter */
    public function index(Request $request): JsonResponse
    {
        $filters = $request->only(['category_id']);
        $paginator = $this->service->list($filters);

        return ApiResponse::success(
            $this->paginatedPayload($paginator),
            'Services retrieved.',
        );
    }

    /** GET /provider/services — authenticated provider's own listings */
    public function mine(Request $request): JsonResponse
    {
        $paginator = $this->service->listMine($request->user());
        return ApiResponse::success(
            $this->paginatedPayload($paginator),
            'Your services retrieved.',
        );
    }

    /**
     * GET /provider/services/commission-preview?category_id=&price=
     *
     * §6.7 — live "At {price}, {category}/{tier} commission is {rate}.
     * You keep ~{net}." line, computed with the provider's real tier rate
     * (v3 §8.1) and the §8.2 commission math so the editor can render it
     * as the provider types a price.
     */
    public function commissionPreview(Request $request): JsonResponse
    {
        $data = $request->validate([
            'category_id' => ['required', 'integer', 'exists:categories,id'],
            'price'       => ['required', 'numeric', 'min:0.01', 'max:99999.99'],
        ]);

        $preview = $this->service->commissionPreview(
            $request->user(),
            (int) $data['category_id'],
            (float) $data['price'],
        );

        return ApiResponse::success($preview, 'Commission preview calculated.');
    }

    private function paginatedPayload(\Illuminate\Pagination\LengthAwarePaginator $paginator): array
    {
        return [
            'data'         => ServiceResource::collection($paginator->getCollection()),
            'current_page' => $paginator->currentPage(),
            'last_page'    => $paginator->lastPage(),
            'per_page'     => $paginator->perPage(),
            'total'        => $paginator->total(),
        ];
    }

    /** GET /services/{service} */
    public function show(string $service): JsonResponse
    {
        $found = $this->service->findOrFail($service);
        return ApiResponse::success(new ServiceResource($found), 'Service retrieved.');
    }

    /** GET /services/{service}/booked-slots — public, returns occupied time ranges for next 14 days */
    public function bookedSlots(string $service): JsonResponse
    {
        $svc = Service::find($service);
        if (!$svc) throw new NotFoundException('Service');

        $slots = Booking::where('provider_id', $svc->provider_id)
            ->whereIn('status', ['REQUESTED', 'QUOTED', 'ACCEPTED', 'FUNDS_HELD', 'IN_PROGRESS'])
            ->where('scheduled_end', '>', now())
            ->where('scheduled_start', '<', now()->addDays(15))
            ->select('scheduled_start', 'scheduled_end')
            ->orderBy('scheduled_start')
            ->get()
            ->map(fn ($b) => [
                'start' => $b->scheduled_start->toIso8601String(),
                'end'   => $b->scheduled_end->toIso8601String(),
            ])
            ->values();

        return ApiResponse::success(['slots' => $slots]);
    }

    /** POST /provider/services */
    public function store(StoreServiceRequest $request): JsonResponse
    {
        $created = $this->service->create($request->user(), $request->validated());
        return ApiResponse::success(new ServiceResource($created), 'Service created.', 201);
    }

    /** PUT /provider/services/{service} */
    public function update(UpdateServiceRequest $request, string $service): JsonResponse
    {
        $updated = $this->service->update($request->user(), $service, $request->validated());
        return ApiResponse::success(new ServiceResource($updated), 'Service updated.');
    }

    /** DELETE /provider/services/{service} */
    public function destroy(Request $request, string $service): JsonResponse
    {
        $this->service->delete($request->user(), $service);
        return ApiResponse::success(null, 'Service deleted.');
    }

    /** POST /provider/services/{service}/photos */
    public function uploadPhoto(Request $request, string $service): JsonResponse
    {
        $request->validate([
            'photo' => ['required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
        ]);

        $svc = Service::find($service);
        if (! $svc || $svc->provider_id !== $request->user()->id) {
            throw new ForbiddenException('You do not own this service.');
        }

        if ($svc->photos()->count() >= 8) {
            throw new \App\Exceptions\Api\ApiException(
                \App\Enums\ErrorCode::VALIDATION_ERROR,
                'A service may have at most 8 photos.',
            );
        }

        $path  = $request->file('photo')->store('service_photos', 'public');
        $order = (int) ($svc->photos()->max('display_order') ?? -1) + 1;
        $photo = $svc->photos()->create(['path' => $path, 'display_order' => $order]);

        return ApiResponse::success(new ServicePhotoResource($photo), 'Photo uploaded.', 201);
    }

    /**
     * PUT /provider/services/{service}/photos/order
     *
     * Persists the gallery order — index 0 is the cover. The client sends the
     * full ordered list of photo ids after a drag/move so display_order stays
     * contiguous and the first photo is always the cover.
     */
    public function reorderPhotos(Request $request, string $service): JsonResponse
    {
        $data = $request->validate([
            'photo_ids'   => ['required', 'array', 'min:1'],
            'photo_ids.*' => ['integer'],
        ]);

        $svc = Service::find($service);
        if (! $svc || $svc->provider_id !== $request->user()->id) {
            throw new ForbiddenException('You do not own this service.');
        }

        $owned = $svc->photos()->pluck('id')->all();
        foreach ($data['photo_ids'] as $position => $photoId) {
            if (! in_array($photoId, $owned, true)) {
                throw new NotFoundException('Photo');
            }
            $svc->photos()->whereKey($photoId)->update(['display_order' => $position]);
        }

        return ApiResponse::success(
            ServicePhotoResource::collection($svc->photos()->get()),
            'Photos reordered.',
        );
    }

    /** DELETE /provider/services/{service}/photos/{photo} */
    public function deletePhoto(Request $request, string $service, int $photo): JsonResponse
    {
        $svc = Service::find($service);
        if (! $svc || $svc->provider_id !== $request->user()->id) {
            throw new ForbiddenException('You do not own this service.');
        }

        $p = $svc->photos()->find($photo);
        if (! $p) {
            throw new NotFoundException('Photo');
        }

        Storage::disk('public')->delete($p->path);
        $p->delete();

        return ApiResponse::success(null, 'Photo deleted.');
    }
}
