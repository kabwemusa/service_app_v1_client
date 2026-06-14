<?php

namespace App\Enums;

enum PaymentMode: string
{
    case DIRECT = 'DIRECT';
    case ESCROW = 'ESCROW';
}
