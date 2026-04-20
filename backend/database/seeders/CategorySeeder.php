<?php

namespace Database\Seeders;

use App\Models\Category;
use Illuminate\Database\Seeder;

class CategorySeeder extends Seeder
{
    public function run(): void
    {
        $categories = [
            ['name' => 'Tutoring',       'icon_url' => null],
            ['name' => 'Laundry',        'icon_url' => null],
            ['name' => 'Photography',    'icon_url' => null],
            ['name' => 'Delivery',       'icon_url' => null],
            ['name' => 'Graphic Design', 'icon_url' => null],
            ['name' => 'Hair & Beauty',  'icon_url' => null],
            ['name' => 'Cleaning',       'icon_url' => null],
            ['name' => 'Tech Support',   'icon_url' => null],
        ];

        foreach ($categories as $cat) {
            Category::firstOrCreate(['name' => $cat['name']], $cat);
        }
    }
}
