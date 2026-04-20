<?php

namespace App\Enums;

enum DocType: string
{
    case NRC              = 'NRC';
    case PASSPORT         = 'PASSPORT';
    case DRIVERS_LICENSE  = 'DRIVERS_LICENSE';
    case PROOF_OF_ADDRESS = 'PROOF_OF_ADDRESS';
    case SELFIE           = 'SELFIE';
    case CERTIFICATE      = 'CERTIFICATE';
}
