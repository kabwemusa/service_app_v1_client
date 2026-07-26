<?php

namespace App\Enums;

/**
 * Kinds of event recorded in the append-only consent audit (consent_records).
 */
enum ConsentEvent: string
{
    case GRANT     = 'GRANT';      // first-time acceptance of the required set
    case RECONSENT = 'RECONSENT';  // re-acceptance after a material version bump
    case WITHDRAW  = 'WITHDRAW';   // withdrawal of core or an optional processing
    case DECLINE   = 'DECLINE';    // user declined at the gate — cannot proceed
}
