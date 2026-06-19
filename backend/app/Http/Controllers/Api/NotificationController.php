<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DeviceToken;
use App\Models\Notification;
use App\Models\NotificationSetting;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    /** GET /notifications?page=1&filter=unread */
    public function index(Request $request): JsonResponse
    {
        $query = Notification::forUser($request->user()->id)
            ->orderByRaw('read_at IS NOT NULL')
            ->orderByDesc('created_at');

        if ($request->query('filter') === 'unread') {
            $query->unread();
        }

        $paginator = $query->paginate(20);

        $unreadCount = Notification::forUser($request->user()->id)->unread()->count();

        return ApiResponse::success([
            'data'         => $paginator->getCollection(),
            'current_page' => $paginator->currentPage(),
            'last_page'    => $paginator->lastPage(),
            'total'        => $paginator->total(),
            'unread_count' => $unreadCount,
        ]);
    }

    /** GET /notifications/unread-count */
    public function unreadCount(Request $request): JsonResponse
    {
        $count = Notification::forUser($request->user()->id)->unread()->count();

        return ApiResponse::success(['count' => $count]);
    }

    /** PATCH /notifications/{id}/read */
    public function markRead(Request $request, string $id): JsonResponse
    {
        $notification = Notification::forUser($request->user()->id)->findOrFail($id);

        if (!$notification->read_at) {
            $notification->update(['read_at' => now()]);
        }

        return ApiResponse::success($notification);
    }

    /** POST /notifications/mark-all-read */
    public function markAllRead(Request $request): JsonResponse
    {
        $count = Notification::forUser($request->user()->id)
            ->unread()
            ->update(['read_at' => now()]);

        return ApiResponse::success(['count' => $count]);
    }

    /** POST /notifications/{id}/ack — client acknowledges delivery for latency tracking + SMS dedup */
    public function ack(Request $request, string $id): JsonResponse
    {
        $notification = Notification::forUser($request->user()->id)->findOrFail($id);

        if (!$notification->ack_time) {
            $notification->update(['ack_time' => now(), 'push_status' => 'acked']);
        }

        return ApiResponse::success(['acked' => true]);
    }

    /** GET /notifications/server-time — clock sync for second-accurate countdown derivation */
    public function serverTime(): JsonResponse
    {
        return ApiResponse::success(['server_time' => now()->toIso8601String()]);
    }

    /** GET /notifications/settings */
    public function getSettings(Request $request): JsonResponse
    {
        $settings = NotificationSetting::forUser($request->user()->id);

        return ApiResponse::success([
            'categories'  => $settings->categories,
            'quiet_hours' => $settings->quiet_hours,
        ]);
    }

    /** PUT /notifications/settings */
    public function updateSettings(Request $request): JsonResponse
    {
        $request->validate([
            'categories'                 => 'required|array',
            'categories.bookings'        => 'required|array',
            'categories.payments'        => 'required|array',
            'categories.reviews'         => 'required|array',
            'categories.verification'    => 'required|array',
            'categories.moderation'      => 'required|array',
            'categories.referrals'       => 'required|array',
            'categories.safety'          => 'required|array',
            'categories.marketing'       => 'required|array',
            'quiet_hours'                => 'required|array',
            'quiet_hours.enabled'        => 'required|boolean',
            'quiet_hours.start'          => 'required|string|date_format:H:i',
            'quiet_hours.end'            => 'required|string|date_format:H:i',
        ]);

        $categories = $request->input('categories');

        // Safety/critical cannot be fully disabled — enforce at least in_app
        if (isset($categories['safety'])) {
            $safety = $categories['safety'];
            if (!($safety['push'] ?? false) && !($safety['sms'] ?? false) && !($safety['in_app'] ?? false)) {
                $categories['safety']['in_app'] = true;
            }
        }

        $settings = NotificationSetting::forUser($request->user()->id);
        $settings->update([
            'categories'  => $categories,
            'quiet_hours' => $request->input('quiet_hours'),
        ]);

        return ApiResponse::success([
            'categories'  => $settings->categories,
            'quiet_hours' => $settings->quiet_hours,
        ]);
    }

    /** POST /notifications/device-token — register an Expo push token */
    public function registerToken(Request $request): JsonResponse
    {
        $request->validate([
            'token'    => 'required|string|max:500',
            'platform' => 'required|in:ios,android,web',
        ]);

        DeviceToken::updateOrCreate(
            ['token' => $request->input('token')],
            [
                'user_id'      => $request->user()->id,
                'platform'     => $request->input('platform'),
                'last_used_at' => now(),
            ],
        );

        return ApiResponse::success(null, 'Token registered.');
    }

    /** DELETE /notifications/device-token?token=... — unregister on logout */
    public function unregisterToken(Request $request): JsonResponse
    {
        $token = $request->query('token');
        if (!$token) {
            return ApiResponse::error('Token is required.', 'VALIDATION_ERROR', 422);
        }

        DeviceToken::where('token', $token)
            ->where('user_id', $request->user()->id)
            ->delete();

        return ApiResponse::success(null, 'Token removed.');
    }
}
