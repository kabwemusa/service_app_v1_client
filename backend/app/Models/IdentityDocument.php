<?php

namespace App\Models;

use App\Enums\DocStatus;
use App\Enums\DocType;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class IdentityDocument extends Model
{
    public $incrementing = false;
    public $timestamps = false;
    protected $keyType = 'string';

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
        });
    }

    protected $fillable = [
        'user_id',
        'doc_type',
        'doc_number_hash',
        'doc_storage_url',
        'status',
        'confidence_score',
        'extracted_fields',
        'reviewer_id',
        'review_notes',
        'expires_on',
        'submitted_at',
        'reviewed_at',
    ];

    protected function casts(): array
    {
        return [
            'extracted_fields' => 'array',
            'confidence_score' => 'float',
            'submitted_at'     => 'datetime',
            'reviewed_at'      => 'datetime',
            'expires_on'       => 'date',
        ];
    }

    public function docType(): DocType
    {
        return DocType::from($this->doc_type);
    }

    public function docStatus(): DocStatus
    {
        return DocStatus::from($this->status);
    }

    public function isPassed(): bool
    {
        return $this->docStatus()->isPassed();
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function reviewer()
    {
        return $this->belongsTo(User::class, 'reviewer_id');
    }
}
