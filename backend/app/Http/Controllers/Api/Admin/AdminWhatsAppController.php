<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\AdminWhatsAppService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin WhatsApp & Conversation Ops module API (consumed by
 * admin/src/lib/api/whatsapp.ts). Capability gating: platform.ops.
 */
class AdminWhatsAppController extends Controller
{
    public function __construct(private readonly AdminWhatsAppService $service) {}

    public function overview(): JsonResponse
    {
        return response()->json($this->service->overview());
    }

    public function templates(): JsonResponse
    {
        return response()->json(['data' => $this->service->templates()]);
    }

    public function conversations(Request $request): JsonResponse
    {
        return response()->json($this->service->conversations([
            'page' => $request->integer('page', 1),
            'view' => $request->string('view')->toString(),
        ]));
    }

    public function nudge(string $conversationId, Request $request): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:10', 'max:2000']]);
        return response()->json($this->service->nudge($conversationId, $request->user(), $data['reason']));
    }

    public function markAbandoned(string $conversationId, Request $request): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:10', 'max:2000']]);
        return response()->json($this->service->markAbandoned($conversationId, $request->user(), $data['reason']));
    }

    public function logs(Request $request): JsonResponse
    {
        return response()->json($this->service->logs([
            'page'   => $request->integer('page', 1),
            'kind'   => $request->string('kind')->toString(),
            'status' => $request->string('status')->toString(),
        ]));
    }
}
