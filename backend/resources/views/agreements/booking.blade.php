@php
    /** @var array $a  Booking Agreement snapshot (real data only — no phone/NRC/coords/trust score). */
    $money = fn ($v) => 'ZMW ' . number_format((float) $v, 2);
    $dt = function ($iso) {
        if (! $iso) return '—';
        try { return \Illuminate\Support\Carbon::parse($iso)->format('D, d M Y · H:i'); }
        catch (\Throwable $e) { return $iso; }
    };
    $p = $a['pricing'];
@endphp
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
    * { box-sizing: border-box; }
    body { font-family: "DejaVu Sans", sans-serif; color: #1a1a1a; font-size: 12px; line-height: 1.5; margin: 0; }
    .wrap { padding: 32px 36px; }
    .head { border-bottom: 2px solid #7a1f2b; padding-bottom: 14px; margin-bottom: 18px; }
    .company { font-size: 16px; font-weight: 700; color: #7a1f2b; }
    .doc-title { font-size: 22px; font-weight: 700; margin: 6px 0 2px; }
    .doc-sub { font-size: 12px; color: #666; }
    .meta { margin-top: 8px; font-size: 11px; color: #444; }
    .meta strong { color: #1a1a1a; }
    .preamble { background: #f6f2f3; border: 1px solid #e7dcde; border-radius: 6px; padding: 10px 12px; margin: 14px 0 18px; font-size: 11px; color: #444; }
    .section { margin-bottom: 16px; }
    .section h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #7a1f2b; border-bottom: 1px solid #eee; padding-bottom: 4px; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; padding: 3px 0; }
    td.k { width: 34%; color: #666; }
    td.v { color: #1a1a1a; font-weight: 600; }
    .parties td { width: 50%; padding-right: 12px; }
    .party-name { font-size: 14px; font-weight: 700; }
    .facts { margin: 4px 0 0; padding-left: 16px; color: #444; font-weight: 400; }
    .facts li { font-size: 11px; }
    ul.list { margin: 4px 0 0; padding-left: 16px; }
    ul.list li { padding: 1px 0; }
    .price-box { border: 1px solid #e0d3d5; border-radius: 6px; padding: 12px 14px; background: #fbf9f9; }
    .price-total { font-size: 16px; font-weight: 700; color: #7a1f2b; }
    .rule { font-size: 11px; color: #555; margin-top: 6px; }
    .footer { margin-top: 22px; border-top: 1px solid #eee; padding-top: 10px; font-size: 10px; color: #888; }
    .tag { display: inline-block; background: #eee; border-radius: 4px; padding: 1px 7px; font-size: 10px; color: #444; }
</style>
</head>
<body>
<div class="wrap">

    <div class="head">
        <div class="company">{{ $a['company'] }}</div>
        <div class="doc-title">{{ $a['title'] }}</div>
        <div class="doc-sub">{{ $a['subtitle'] }}</div>
        <div class="meta">
            <strong>Reference:</strong> {{ $a['reference'] }} &nbsp;·&nbsp;
            <strong>Generated:</strong> {{ $dt($a['generated_at']) }}
        </div>
    </div>

    <div class="preamble">{{ $a['copy']['preamble'] }}</div>

    <div class="section">
        <h2>Parties</h2>
        <table class="parties">
            <tr>
                <td>
                    <div class="tag">Provider</div>
                    <div class="party-name">{{ $a['provider']['name'] }}</div>
                    <div>{{ $a['provider']['tier_label'] }} provider{{ $a['provider']['identity_verified'] ? ' · Identity verified' : '' }}</div>
                    @if(!empty($a['provider']['verified_facts']))
                        <ul class="facts">
                            @foreach($a['provider']['verified_facts'] as $f)<li>{{ $f }}</li>@endforeach
                        </ul>
                    @endif
                </td>
                <td>
                    <div class="tag">Customer</div>
                    <div class="party-name">{{ $a['customer']['name'] }}</div>
                </td>
            </tr>
        </table>
    </div>

    <div class="section">
        <h2>Service</h2>
        <table>
            <tr><td class="k">Service</td><td class="v">{{ $a['service']['title'] ?? '—' }}</td></tr>
            @if($a['service']['category'])<tr><td class="k">Category</td><td class="v">{{ $a['service']['category'] }}</td></tr>@endif
        </table>

        @if(!empty($a['service']['inclusions']))
            <div style="margin-top:6px;"><span class="k" style="color:#666;">Included:</span>
                <ul class="list">@foreach($a['service']['inclusions'] as $inc)<li>{{ $inc }}</li>@endforeach</ul>
            </div>
        @endif

        @if($a['service']['agreed_scope'])
            <div style="margin-top:6px;"><span class="k" style="color:#666;">Agreed scope:</span>
                @if(!empty($a['service']['agreed_scope']['inclusions']))
                    <ul class="list">@foreach($a['service']['agreed_scope']['inclusions'] as $inc)<li>{{ $inc }}</li>@endforeach</ul>
                @endif
                @if(!empty($a['service']['agreed_scope']['message']))<div class="rule">{{ $a['service']['agreed_scope']['message'] }}</div>@endif
            </div>
        @endif

        @if(!empty($a['service']['addons']))
            <div style="margin-top:6px;"><span class="k" style="color:#666;">Add-ons:</span>
                <ul class="list">@foreach($a['service']['addons'] as $ad)<li>{{ $ad['name'] }} — {{ $money($ad['price']) }}</li>@endforeach</ul>
            </div>
        @endif
    </div>

    <div class="section">
        <h2>Pricing — {{ $p['label'] }}</h2>
        <div class="price-box">
            @switch($p['model'])
                @case('HOURLY_CAPPED')
                    <table>
                        <tr><td class="k">Rate</td><td class="v">{{ $money($p['rate']) }} / hour</td></tr>
                        <tr><td class="k">Minimum</td><td class="v">{{ $p['minimum_hours'] }} hour(s)</td></tr>
                        <tr><td class="k">Spend cap</td><td class="v price-total">{{ $money($p['cap']) }}</td></tr>
                    </table>
                    @break
                @case('PROVIDER_SCOPE')
                    <table><tr><td class="k">Approved quote</td><td class="v price-total">{{ $money($p['quote']) }}</td></tr></table>
                    @break
                @case('QUOTE_DEPOSIT')
                    <table>
                        <tr><td class="k">Quote</td><td class="v">{{ $money($p['quote']) }}</td></tr>
                        <tr><td class="k">Deposit held now</td><td class="v price-total">{{ $money($p['deposit']) }}</td></tr>
                        <tr><td class="k">Balance on completion</td><td class="v">{{ $money($p['balance']) }}</td></tr>
                    </table>
                    @break
                @default
                    <table><tr><td class="k">Fixed price</td><td class="v price-total">{{ $money($p['price']) }}</td></tr></table>
            @endswitch
            <div class="rule">{{ $p['rule'] }}</div>
        </div>
    </div>

    <div class="section">
        <h2>Schedule &amp; place</h2>
        <table>
            <tr><td class="k">Date &amp; time</td><td class="v">{{ $dt($a['schedule']['start']) }}</td></tr>
            <tr><td class="k">{{ $a['service']['is_remote'] ? 'Delivery' : 'Area' }}</td><td class="v">{{ $a['schedule']['place'] }}</td></tr>
        </table>
    </div>

    <div class="section">
        <h2>Payment terms</h2>
        <table>
            <tr><td class="k">Held in escrow</td><td class="v price-total">{{ $money($a['payment']['escrow_held']) }}</td></tr>
            @if($a['payment']['protection_fee'] > 0)
                <tr><td class="k">Incl. buyer protection</td><td class="v">{{ $money($a['payment']['protection_fee']) }}</td></tr>
            @endif
        </table>
        <div class="rule">{{ $a['payment']['terms_text'] }}</div>
    </div>

    <div class="section">
        <h2>Terms accepted</h2>
        <div class="rule">{{ $a['copy']['terms_ref'] }}</div>
    </div>

    <div class="footer">{{ $a['copy']['footer'] }}</div>

</div>
</body>
</html>
