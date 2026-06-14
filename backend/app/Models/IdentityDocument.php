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
        // Admin-review (Verification queue)
        'claimed_by_admin_id',
        'claimed_at',
        'reviewer_admin_id',
        'info_requested_at',
        'timeline',
    ];

    protected function casts(): array
    {
        return [
            'extracted_fields'  => 'array',
            'confidence_score'  => 'float',
            'submitted_at'      => 'datetime',
            'reviewed_at'       => 'datetime',
            'expires_on'        => 'date',
            'claimed_at'        => 'datetime',
            'info_requested_at' => 'datetime',
            'timeline'          => 'array',
        ];
    }

    /**
     * Append a progression event (submitted, reviewed, resubmitted, …) to the
     * timeline. Keep it PII-free: status, actor label, and an optional note only.
     * Does not persist — call within the caller's update()/save() flow, or pass
     * $save = true to persist immediately.
     */
    public function pushEvent(string $label, string $actor, ?string $note = null, ?string $status = null, bool $save = false): void
    {
        $timeline   = $this->timeline ?? [];
        $timeline[] = array_filter([
            'at'     => now()->toIso8601String(),
            'label'  => $label,
            'actor'  => $actor,
            'status' => $status ?? $this->status,
            'note'   => $note,
        ], static fn ($v) => $v !== null);

        $this->timeline = $timeline;

        if ($save) {
            $this->save();
        }
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

    public function claimedByAdmin()
    {
        return $this->belongsTo(AdminUser::class, 'claimed_by_admin_id');
    }

    public function reviewerAdmin()
    {
        return $this->belongsTo(AdminUser::class, 'reviewer_admin_id');
    }
}
