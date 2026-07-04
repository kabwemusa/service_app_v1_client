<?php

namespace App\Observers;

use App\Events\AdminQueueEvent;
use App\Models\IdentityDocument;

class IdentityDocumentObserver
{
    public function created(IdentityDocument $document): void
    {
        AdminQueueEvent::fire('verification', 'verification.submitted', $document->id, [
            'user_id'  => $document->user_id,
            'doc_type' => $document->doc_type,
            'status'   => $document->status,
        ]);
    }
}
