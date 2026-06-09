<?php

namespace App\Services;

use App\Exceptions\Api\ConflictException;
use App\Exceptions\Api\NotFoundException;
use App\Models\Category;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Str;

class CategoryService
{
    /** Active top-level categories ordered by display_order, with children eager-loaded. */
    public function listActive(): Collection
    {
        return Category::where('is_active', true)
            ->whereNull('parent_id')
            ->with(['children'])
            ->orderBy('display_order')
            ->orderBy('name')
            ->get();
    }

    /** All categories (admin view), hierarchical. */
    public function listAll(): Collection
    {
        return Category::whereNull('parent_id')
            ->with(['children'])
            ->orderBy('display_order')
            ->orderBy('name')
            ->get();
    }

    public function create(array $data): Category
    {
        if (Category::where('name', $data['name'])->exists()) {
            throw new ConflictException("A category named '{$data['name']}' already exists.");
        }

        if (empty($data['slug'])) {
            $data['slug'] = $this->uniqueSlug($data['name']);
        }

        return Category::create($data);
    }

    public function update(int $id, array $data): Category
    {
        $category = $this->findOrFail($id);
        $category->update($data);
        return $category->fresh();
    }

    public function delete(int $id): void
    {
        $this->findOrFail($id)->delete();
    }

    public function findOrFail(int $id): Category
    {
        return Category::findOr($id, fn () => throw new NotFoundException('Category'));
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name);
        $slug = $base;
        $i    = 1;
        while (Category::where('slug', $slug)->exists()) {
            $slug = "{$base}-{$i}";
            $i++;
        }
        return $slug;
    }
}
