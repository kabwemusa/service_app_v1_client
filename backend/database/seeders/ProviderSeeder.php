<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Seeds 10 verified providers spread across Lusaka neighbourhoods.
 * All use *.edu.zm emails to pass the registration guard.
 * Ratings, completion rates and availability are varied to give the
 * Bayesian ranking engine meaningful data to work with.
 */
class ProviderSeeder extends Seeder
{
    public function run(): void
    {
        $providers = [
            [
                'name'            => 'Chanda Mwale',
                'email'           => 'chanda.mwale@students.unza.zm',
                'r_raw'           => 4.80,
                'v_reviews'       => 23,
                'completion_rate' => 0.96,
                'lat'             => -15.4160, 'lng' => 28.2820, // Lusaka CBD
                'max_radius'      => 7,
                'momo_provider'   => 'MTN',
                'momo_number'     => '0971000001',
                'nrc'             => '123456/10/1',
                'availability'    => [
                    'MON' => [['start' => '08:00', 'end' => '17:00']],
                    'TUE' => [['start' => '08:00', 'end' => '17:00']],
                    'WED' => [['start' => '08:00', 'end' => '12:00']],
                    'THU' => [['start' => '08:00', 'end' => '17:00']],
                    'FRI' => [['start' => '08:00', 'end' => '15:00']],
                    'SAT' => [['start' => '09:00', 'end' => '13:00']],
                    'SUN' => [],
                ],
            ],
            [
                'name'            => 'Mutale Banda',
                'email'           => 'mutale.banda@cbu.ac.zm',
                'r_raw'           => 4.60,
                'v_reviews'       => 15,
                'completion_rate' => 0.90,
                'lat'             => -15.3980, 'lng' => 28.3100, // Rhodespark
                'max_radius'      => 5,
                'momo_provider'   => 'AIRTEL',
                'momo_number'     => '0961000002',
                'nrc'             => '234567/10/2',
                'availability'    => [
                    'MON' => [['start' => '09:00', 'end' => '18:00']],
                    'TUE' => [],
                    'WED' => [['start' => '09:00', 'end' => '18:00']],
                    'THU' => [['start' => '09:00', 'end' => '18:00']],
                    'FRI' => [['start' => '09:00', 'end' => '16:00']],
                    'SAT' => [['start' => '10:00', 'end' => '14:00']],
                    'SUN' => [],
                ],
            ],
            [
                'name'            => 'Naomi Phiri',
                'email'           => 'naomi.phiri@mu.ac.zm',
                'r_raw'           => 4.90,
                'v_reviews'       => 41,
                'completion_rate' => 0.98,
                'lat'             => -15.4400, 'lng' => 28.3200, // Kabulonga
                'max_radius'      => 10,
                'momo_provider'   => 'MTN',
                'momo_number'     => '0977000003',
                'nrc'             => '345678/10/3',
                'availability'    => [
                    'MON' => [['start' => '07:00', 'end' => '19:00']],
                    'TUE' => [['start' => '07:00', 'end' => '19:00']],
                    'WED' => [['start' => '07:00', 'end' => '19:00']],
                    'THU' => [['start' => '07:00', 'end' => '19:00']],
                    'FRI' => [['start' => '07:00', 'end' => '17:00']],
                    'SAT' => [['start' => '08:00', 'end' => '15:00']],
                    'SUN' => [['start' => '10:00', 'end' => '14:00']],
                ],
            ],
            [
                'name'            => 'Bwalya Tembo',
                'email'           => 'bwalya.tembo@students.unza.zm',
                'r_raw'           => 4.20,
                'v_reviews'       => 8,
                'completion_rate' => 0.85,
                'lat'             => -15.4000, 'lng' => 28.3400, // Woodlands
                'max_radius'      => 5,
                'momo_provider'   => 'ZAMTEL',
                'momo_number'     => '0951000004',
                'nrc'             => '456789/10/4',
                'availability'    => [
                    'MON' => [],
                    'TUE' => [['start' => '14:00', 'end' => '20:00']],
                    'WED' => [['start' => '14:00', 'end' => '20:00']],
                    'THU' => [['start' => '14:00', 'end' => '20:00']],
                    'FRI' => [['start' => '14:00', 'end' => '20:00']],
                    'SAT' => [['start' => '09:00', 'end' => '17:00']],
                    'SUN' => [['start' => '09:00', 'end' => '15:00']],
                ],
            ],
            [
                'name'            => 'Chisomo Nkonde',
                'email'           => 'chisomo.nkonde@lamu.edu.zm',
                'r_raw'           => 4.50,
                'v_reviews'       => 12,
                'completion_rate' => 0.92,
                'lat'             => -15.3700, 'lng' => 28.3500, // Chelston
                'max_radius'      => 8,
                'momo_provider'   => 'MTN',
                'momo_number'     => '0976000005',
                'nrc'             => '567890/10/5',
                'availability'    => [
                    'MON' => [['start' => '08:00', 'end' => '12:00'], ['start' => '13:00', 'end' => '17:00']],
                    'TUE' => [['start' => '08:00', 'end' => '12:00'], ['start' => '13:00', 'end' => '17:00']],
                    'WED' => [['start' => '08:00', 'end' => '12:00']],
                    'THU' => [['start' => '08:00', 'end' => '12:00'], ['start' => '13:00', 'end' => '17:00']],
                    'FRI' => [['start' => '08:00', 'end' => '12:00']],
                    'SAT' => [],
                    'SUN' => [],
                ],
            ],
            [
                'name'            => 'Kelvin Mulenga',
                'email'           => 'kelvin.mulenga@cbu.ac.zm',
                'r_raw'           => 3.80,
                'v_reviews'       => 4,
                'completion_rate' => 0.75,
                'lat'             => -15.4200, 'lng' => 28.3150, // Garden
                'max_radius'      => 4,
                'momo_provider'   => 'AIRTEL',
                'momo_number'     => '0962000006',
                'nrc'             => '678901/10/6',
                'availability'    => [
                    'MON' => [['start' => '15:00', 'end' => '20:00']],
                    'TUE' => [['start' => '15:00', 'end' => '20:00']],
                    'WED' => [],
                    'THU' => [['start' => '15:00', 'end' => '20:00']],
                    'FRI' => [['start' => '15:00', 'end' => '20:00']],
                    'SAT' => [['start' => '10:00', 'end' => '18:00']],
                    'SUN' => [['start' => '10:00', 'end' => '16:00']],
                ],
            ],
            [
                'name'            => 'Thandiwe Lungu',
                'email'           => 'thandiwe.lungu@mu.ac.zm',
                'r_raw'           => 4.70,
                'v_reviews'       => 29,
                'completion_rate' => 0.94,
                'lat'             => -15.4100, 'lng' => 28.3250, // Olympia
                'max_radius'      => 6,
                'momo_provider'   => 'MTN',
                'momo_number'     => '0973000007',
                'nrc'             => '789012/10/7',
                'availability'    => [
                    'MON' => [['start' => '08:00', 'end' => '18:00']],
                    'TUE' => [['start' => '08:00', 'end' => '18:00']],
                    'WED' => [['start' => '08:00', 'end' => '18:00']],
                    'THU' => [['start' => '08:00', 'end' => '18:00']],
                    'FRI' => [['start' => '08:00', 'end' => '16:00']],
                    'SAT' => [['start' => '09:00', 'end' => '14:00']],
                    'SUN' => [],
                ],
            ],
            [
                'name'            => 'Aaron Zulu',
                'email'           => 'aaron.zulu@students.unza.zm',
                'r_raw'           => 0.00,
                'v_reviews'       => 0,
                'completion_rate' => 1.00,
                'lat'             => -15.3900, 'lng' => 28.2900, // Longacres
                'max_radius'      => 5,
                'momo_provider'   => 'MTN',
                'momo_number'     => '0975000008',
                'nrc'             => '890123/10/8',
                'availability'    => [
                    'MON' => [['start' => '09:00', 'end' => '17:00']],
                    'TUE' => [['start' => '09:00', 'end' => '17:00']],
                    'WED' => [['start' => '09:00', 'end' => '17:00']],
                    'THU' => [['start' => '09:00', 'end' => '17:00']],
                    'FRI' => [['start' => '09:00', 'end' => '17:00']],
                    'SAT' => [],
                    'SUN' => [],
                ],
            ],
            [
                'name'            => 'Mwaka Siame',
                'email'           => 'mwaka.siame@lamu.edu.zm',
                'r_raw'           => 4.30,
                'v_reviews'       => 6,
                'completion_rate' => 0.88,
                'lat'             => -15.4500, 'lng' => 28.3400, // Ibex Hill
                'max_radius'      => 7,
                'momo_provider'   => 'AIRTEL',
                'momo_number'     => '0963000009',
                'nrc'             => '901234/10/9',
                'availability'    => [
                    'MON' => [['start' => '10:00', 'end' => '19:00']],
                    'TUE' => [['start' => '10:00', 'end' => '19:00']],
                    'WED' => [],
                    'THU' => [['start' => '10:00', 'end' => '19:00']],
                    'FRI' => [['start' => '10:00', 'end' => '19:00']],
                    'SAT' => [['start' => '10:00', 'end' => '16:00']],
                    'SUN' => [['start' => '11:00', 'end' => '15:00']],
                ],
            ],
            [
                'name'            => 'Grace Mwansa',
                'email'           => 'grace.mwansa@students.unza.zm',
                'r_raw'           => 4.40,
                'v_reviews'       => 18,
                'completion_rate' => 0.91,
                'lat'             => -15.4300, 'lng' => 28.3500, // Chilenje
                'max_radius'      => 6,
                'momo_provider'   => 'MTN',
                'momo_number'     => '0978000010',
                'nrc'             => '012345/10/0',
                'availability'    => [
                    'MON' => [['start' => '07:30', 'end' => '16:30']],
                    'TUE' => [['start' => '07:30', 'end' => '16:30']],
                    'WED' => [['start' => '07:30', 'end' => '16:30']],
                    'THU' => [['start' => '07:30', 'end' => '16:30']],
                    'FRI' => [['start' => '07:30', 'end' => '14:00']],
                    'SAT' => [['start' => '09:00', 'end' => '13:00']],
                    'SUN' => [],
                ],
            ],
        ];

        foreach ($providers as $data) {
            $userId = (string) Str::uuid();

            DB::table('users')->insertOrIgnore([
                'id'              => $userId,
                'email'           => $data['email'],
                'password_hash'   => Hash::make('Password123!'),
                'role'            => 'PROVIDER',
                'is_verified'     => true,
                'v_reviews'       => $data['v_reviews'],
                'r_raw'           => $data['r_raw'],
                'completion_rate' => $data['completion_rate'],
                'last_active_at'  => now()->subHours(rand(1, 72)),
                'created_at'      => now(),
                'updated_at'      => now(),
            ]);

            $insertedId = DB::table('users')->where('email', $data['email'])->value('id');

            DB::table('provider_profiles')->insertOrIgnore([
                'user_id'              => $insertedId,
                'nrc_number'           => $data['nrc'],
                'student_id_url'       => 'kyc/sample_id.jpg',
                'kyc_status'           => 'VERIFIED',
                'momo_provider'        => $data['momo_provider'],
                'momo_number'          => $data['momo_number'],
                'base_location_lat'    => $data['lat'],
                'base_location_lng'    => $data['lng'],
                'max_radius_km'        => $data['max_radius'],
                'availability_matrix'  => json_encode($data['availability']),
                'profile_completeness' => 100,
                'created_at'           => now(),
                'updated_at'           => now(),
            ]);
        }
    }
}
