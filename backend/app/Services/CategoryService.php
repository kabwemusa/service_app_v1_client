<?php

namespace App\Services;

use App\Exceptions\Api\ConflictException;
use App\Exceptions\Api\NotFoundException;
use App\Models\Booking;
use App\Models\Category;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class CategoryService
{
    /** Active top-level categories ordered by display_order, with active children eager-loaded. */
    public function listActive(): Collection
    {
        return Category::where('is_active', true)
            ->whereNull('parent_id')
            ->with(['children'])
            ->orderBy('display_order')
            ->orderBy('name')
            ->get();
    }

    /** All categories (admin view), hierarchical — includes inactive, all children. */
    public function listAll(): Collection
    {
        return Category::whereNull('parent_id')
            ->with(['allChildren'])
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

        $willBeActive = (bool) ($data['is_active'] ?? false);
        $band = $data['commission_band'] ?? null;

        if ($willBeActive && empty($band)) {
            throw ValidationException::withMessages([
                'commission_band' => 'A commission band must be set before a category can be activated (v3 §8.1).',
            ]);
        }

        return Category::create($data);
    }

    public function update(int $id, array $data): Category
    {
        $category = $this->findOrFail($id);

        // Activation guard: cannot go active without a commission band.
        $willBeActive = $data['is_active'] ?? $category->is_active;
        $band = array_key_exists('commission_band', $data)
            ? $data['commission_band']
            : $category->commission_band;

        if ($willBeActive && empty($band)) {
            throw ValidationException::withMessages([
                'commission_band' => 'A commission band must be set before a category can be activated (v3 §8.1).',
            ]);
        }

        // commission_band may not be blanked out once set.
        if (array_key_exists('commission_band', $data) && $data['commission_band'] === null && $category->commission_band !== null) {
            throw ValidationException::withMessages([
                'commission_band' => 'commission_band cannot be removed from a category (v3 §8.1).',
            ]);
        }

        // Cycle-prevention: walk the tree upward from the proposed parent.
        if (isset($data['parent_id']) && $data['parent_id'] !== null) {
            $this->assertNoCycle($id, (int) $data['parent_id']);
        }

        $category->update($data);
        return $category->fresh();
    }

    /**
     * Delete a category.
     * Blocked if: it has child categories, any services (active or historical),
     * or bookings that reference those services.
     */
    public function delete(int $id): void
    {
        $category = $this->findOrFail($id);

        if (Category::where('parent_id', $id)->exists()) {
            throw new ConflictException(
                'Cannot delete a category that has child categories. Reassign or delete the children first.'
            );
        }

        if ($category->services()->exists()) {
            throw new ConflictException(
                'Cannot delete a category that has services. Reassign the services to another category first.'
            );
        }

        $hasBookings = Booking::whereHas(
            'service',
            fn ($q) => $q->where('category_id', $id)
        )->exists();

        if ($hasBookings) {
            throw new ConflictException(
                'Cannot delete a category with booking history. Consider hiding it instead.'
            );
        }

        $category->delete();
    }

    /**
     * Bulk-update display_order for a set of siblings.
     * Items: [['id' => int, 'display_order' => int], ...]
     */
    public function reorder(array $items): void
    {
        DB::transaction(function () use ($items) {
            foreach ($items as $item) {
                Category::where('id', $item['id'])
                    ->update(['display_order' => (int) $item['display_order']]);
            }
        });
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

    /** Walk the tree from $proposedParentId up to the root; throw if $categoryId is encountered. */
    private function assertNoCycle(int $categoryId, int $proposedParentId): void
    {
        $visited = [];
        $current = $proposedParentId;
        while ($current !== null) {
            if (in_array($current, $visited, true)) {
                break; // broken tree — stop rather than loop forever
            }
            if ($current === $categoryId) {
                throw new ConflictException('Setting this parent would create a circular reference.');
            }
            $visited[] = $current;
            $current = Category::find($current)?->parent_id;
        }
    }
}
