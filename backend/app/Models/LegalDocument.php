<?php

namespace App\Models;

use App\Enums\LegalDocumentType;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * A single versioned legal document (one row per type+version). The "current"
 * document a client must render/consent to is resolved by LegalDocumentRepository:
 * the latest `published` row, or — in non-production, when config('legal.draft_mode')
 * is on — the latest `draft`, so the scaffold is reviewable before publication.
 *
 * Wording is DRAFT placeholder pending Zambian legal review (see LegalDocumentSeeder).
 */
class LegalDocument extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';

    protected $fillable = [
        'id', 'type', 'version', 'status', 'title', 'summary',
        'content', 'effective_date', 'is_material',
    ];

    protected function casts(): array
    {
        return [
            'content'        => 'array',
            'effective_date' => 'date',
            'is_material'    => 'boolean',
        ];
    }

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
        });
    }

    public function typeEnum(): ?LegalDocumentType
    {
        return LegalDocumentType::tryFrom($this->type);
    }
}
