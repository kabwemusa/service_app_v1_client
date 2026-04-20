<?php

namespace App\Providers;

use App\Contracts\IdentityVerificationProviderInterface;
use App\Services\IdentityVerification\MockIdentityVerificationProvider;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Swap MockIdentityVerificationProvider for SmileIdVerificationProvider
        // (or equivalent) when IDENTITY_PROVIDER=smileid in .env.
        $this->app->bind(
            IdentityVerificationProviderInterface::class,
            MockIdentityVerificationProvider::class,
        );
    }

    public function boot(): void {}
}
