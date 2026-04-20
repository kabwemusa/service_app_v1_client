<?php

namespace App\Services;

use App\Models\ProviderProfile;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

class ProviderProfileService
{
    /**
     * Return the provider's profile, creating a blank record if none exists.
     */
    public function getOrCreate(User $user): ProviderProfile
    {
        return ProviderProfile::firstOrCreate(
            ['user_id' => $user->id],
            ['profile_completeness' => 0],
        );
    }

    /**
     * Create or update the provider profile with the given fields.
     */
    public function upsert(User $user, array $data): ProviderProfile
    {
        $profile = $this->getOrCreate($user);
        $profile->fill($data);
        $profile->profile_completeness = $this->calculateCompleteness($profile);
        $profile->save();

        return $profile->fresh();
    }

    /**
     * Store the uploaded student-ID document and update the profile.
     *
     * In production: swap Storage::disk('local') for Storage::disk('s3').
     */
    public function uploadKyc(User $user, UploadedFile $file): ProviderProfile
    {
        $profile = $this->getOrCreate($user);

        $path = $file->store("kyc/{$user->id}", 'local');

        $profile->student_id_url = $path;
        $profile->profile_completeness = $this->calculateCompleteness($profile);
        $profile->save();

        return $profile->fresh();
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /**
     * v3 profile completeness scoring (0–100).
     * Mirrors the §9.1 profile strength meter tasks.
     */
    private function calculateCompleteness(ProviderProfile $profile): int
    {
        $score = 0;

        if (! empty($profile->cover_image_url))                                                 $score += 5;
        if (! empty($profile->bio) && mb_strlen($profile->bio) >= 80)                          $score += 5;
        if (! empty($profile->portfolio_images) && count((array) $profile->portfolio_images) >= 1) $score += 10;
        if (($profile->trust_tier ?? 0) >= 2)                                                  $score += 20;  // KYC Tier 2
        if (($profile->trust_tier ?? 0) >= 3)                                                  $score += 15;  // Tier 3
        if (! empty($profile->momo_provider) && ! empty($profile->momo_number))                $score += 10;  // proxy for "set payment"
        if (! empty($profile->availability_matrix) && count((array) $profile->availability_matrix) > 0) $score += 10;

        return min(100, $score);
    }
}
