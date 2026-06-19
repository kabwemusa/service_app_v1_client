<?php

use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Broadcast Channels
|--------------------------------------------------------------------------
|
| Private channel authorization. The user can only subscribe to their own
| notification channel (private-user.{id}).
|
*/

Broadcast::channel('user.{userId}', function ($user, $userId) {
    return $user->id === $userId;
});
