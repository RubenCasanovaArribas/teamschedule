<?php

// ===== CONFIG =====
$secret_key = "YourVeryStrongSecretKeyHere";
$expiry = "2026-03-01";
$authorized = true;

// ===== DATA =====
$utc = gmdate("Y-m-d\TH:i:s\Z");

// Prepare data to sign
$data = $utc . "|" . $authorized . "|" . $expiry;

// Create HMAC signature
$signature = hash_hmac("sha256", $data, $secret_key);

// Return JSON
echo json_encode([
    "utc" => $utc,
    "authorized" => $authorized,
    "expiry" => $expiry,
    "signature" => $signature
]);
