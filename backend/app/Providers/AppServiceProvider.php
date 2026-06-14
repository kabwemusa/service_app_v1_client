<?php

namespace App\Providers;

use App\Contracts\IdentityVerificationProviderInterface;
use App\Contracts\WalletNameLookupInterface;
use App\Services\IdentityVerification\MockIdentityVerificationProvider;
use App\Services\Payment\MockWalletNameProvider;
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

        // v3.2 §4.3 — swap for the real aggregator wallet-name client in production.
        $this->app->bind(
            WalletNameLookupInterface::class,
            MockWalletNameProvider::class,
        );
    }

    public function boot(): void {}
}
