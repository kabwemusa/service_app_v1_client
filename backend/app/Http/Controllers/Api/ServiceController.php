<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\Api\ForbiddenException;
use App\Exceptions\Api\NotFoundException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Service\StoreServiceRequest;
use App\Http\Requests\Service\UpdateServiceRequest;
use App\Http\Resources\ServicePhotoResource;
use App\Http\Resources\ServiceResource;
use App\Models\Service;
use App\Services\ServiceService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
