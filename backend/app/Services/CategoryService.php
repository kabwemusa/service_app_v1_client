<?php

namespace App\Services;

use App\Exceptions\Api\ConflictException;
use App\Exceptions\Api\NotFoundException;
use App\Models\Category;
use Illuminate\Database\Eloquent\Collection;

class CategoryService
{
    public function listActive(): Collection
    {
        return Category::where('is_active', true)->orderBy('name')->get();
    }

    public function listAll(): Collection
    {
        return Category::orderBy('name')->get();
    }

    public function create(array $data): Category
    {
        if (Category::where('name', $data['name'])->exists()) {
            throw new ConflictException("A category named '{$data['name']}' already exists.");
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
}
