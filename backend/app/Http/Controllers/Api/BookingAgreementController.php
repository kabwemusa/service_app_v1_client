<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\Api\NotFoundException;
use App\Http\Controllers\Controller;
use App\Models\BookingAgreement;
use App\Services\BookingAgreementService;
use App\Services\BookingService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Download the immutable, versioned Booking Agreement. Available to BOTH parties
 * (the authenticated routes authorise via BookingService::findOrFail); a separate
 * short-lived SIGNED route lets WhatsApp/Meta fetch the document for a document
 * message without exposing a permanent public URL.
 */
class BookingAgreementController extends Controller
{
    public function __construct(
        private readonly BookingService          $bookings,
        private readonly BookingAgreementService $agreements,
    ) {}

    /** GET /bookings/{id}/agreements — list versions (metadata, party-only). */
    public function index(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->findOrFail($id, $request->user());

        $versions = $booking->agreements()->get()->map(fn (BookingAgreement $a) => [
            'version'              => $a->version,
            'reason'               => $a->reason,
            'format'               => $a->format,
            'generated_at'         => $a->generated_at?->toIso8601String(),
            'terms_version'        => $a->terms_version,
            'terms_effective_date' => $a->terms_effective_date?->toDateString(),
            'download_url'         => url("/api/bookings/{$booking->id}/agreement/{$a->version}"),
        ]);

        return ApiResponse::success([
            'title'    => config('agreements.brand.title'),
            'versions' => $versions,
        ], 'Agreements retrieved.');
    }

    /**
     * GET /bookings/{id}/agreement/link — a short-lived signed URL to the latest
     * document. Lets thin clients (mobile Linking, PWA) open the PDF without
     * streaming a binary through the authenticated JSON layer.
     */
    public function link(Request $request, string $id): JsonResponse
    {
        $booking   = $this->bookings->findOrFail($id, $request->user());
        $agreement = $this->agreements->latestFor($booking);

        if (! $agreement) {
            throw new NotFoundException('Agreement');
        }

        return ApiResponse::success([
            'url'      => $this->agreements->signedUrl($agreement),
            'filename' => $this->agreements->filenameFor($agreement),
            'version'  => $agreement->version,
        ], 'Agreement link generated.');
    }

    /** GET /bookings/{id}/agreement — download the latest version (party-only). */
    public function latest(Request $request, string $id): Response
    {
        $booking   = $this->bookings->findOrFail($id, $request->user());
        $agreement = $this->agreements->latestFor($booking);

        if (! $agreement) {
            throw new NotFoundException('Agreement');
        }

        return $this->stream($agreement);
    }

    /** GET /bookings/{id}/agreement/{version} — download a specific version. */
    public function version(Request $request, string $id, int $version): Response
    {
        $booking   = $this->bookings->findOrFail($id, $request->user());
        $agreement = $booking->agreements()->where('version', $version)->first();

        if (! $agreement) {
            throw new NotFoundException('Agreement');
        }

        return $this->stream($agreement);
    }

    /**
     * GET /agreements/{agreement}/download — SIGNED public download (WhatsApp/Meta
     * fetch). No auth: the URL is signed + time-limited (config TTL). Used only to
     * hand Meta a fetchable link for a document message.
     */
    public function signedDownload(BookingAgreement $agreement): Response
    {
        return $this->stream($agreement);
    }

    private function stream(BookingAgreement $agreement): Response
    {
        $bytes    = $this->agreements->bytes($agreement);
        $filename = $this->agreements->filenameFor($agreement);

        return response($bytes, 200, [
            'Content-Type'        => $this->agreements->mimeFor($agreement),
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Content-Length'      => strlen($bytes),
        ]);
    }
}
