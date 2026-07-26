<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Draft mode
    |--------------------------------------------------------------------------
    | When ON, the API will surface the latest *draft* legal document (not only
    | `published` rows) and every client shows a prominent
    | "DRAFT — pending legal review" banner. This MUST be OFF in production so
    | placeholder scaffold text is never mistaken for approved legal wording.
    | Defaults to on for any non-production environment.
    */
    'draft_mode' => env('LEGAL_DRAFT_MODE', env('APP_ENV', 'production') !== 'production'),

    /*
    |--------------------------------------------------------------------------
    | Controller identity + contacts (Data Protection Act No. 3 of 2021)
    |--------------------------------------------------------------------------
    | The Privacy Policy scaffold references these. Final values are a
    | business/legal decision — a lawyer confirms the registered controller name
    | and the Office of the Data Protection Commissioner registration status.
    */
    'company_name'   => env('LEGAL_COMPANY_NAME', 'Sebenza Technologies Ltd'),
    'privacy_contact'=> env('LEGAL_PRIVACY_CONTACT', 'privacy@sebenza.co.zm'),  // PLACEHOLDER
    'support_contact'=> env('LEGAL_SUPPORT_CONTACT', 'support@sebenza.co.zm'),  // PLACEHOLDER

];
