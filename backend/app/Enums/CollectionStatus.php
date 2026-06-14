<?php

namespace App\Enums;

enum CollectionStatus: string
{
    case COLLECTED   = 'COLLECTED';
    case UNCOLLECTED = 'UNCOLLECTED';
}
