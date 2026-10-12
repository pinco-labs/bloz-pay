<?php
// Narrow WordPress API fixture: tests plugin decisions, not a real WP installation.
define('ABSPATH', __DIR__);
define('BLOZ_PAY_MERCHANT_URL', 'http://127.0.0.1:8083');
define('BLOZ_PAY_MERCHANT_KEY', 'test-only');
define('BLOZ_PAY_WP_RECEIPT_KEY', str_repeat('a', 64));
define('BLOZ_PAY_WP_SITE_ID', str_repeat('b', 32));
$scenario = $argv[1] ?? 'content'; $meta = [];
function add_action(...$args) {} function add_shortcode(...$args) {}
function nocache_headers() {} function register_post_type($name, $args) { $GLOBALS['type'] = $args; }
function is_user_logged_in() { return $GLOBALS['scenario'] !== 'guest'; }
function check_ajax_referer(...$args) { return $GLOBALS['scenario'] !== 'nonce'; }
function get_current_user_id() { return 7; }
function sanitize_text_field($value) { return $value; } function wp_unslash($value) { return $value; }
function get_posts($args) { return [(object) ['ID' => 10, 'post_content' => 'PRIVATE ARTICLE']]; }
function wp_json_encode($value) { return json_encode($value); }
function update_user_meta($id, $key, $value) { $GLOBALS['meta'][$key] = $value; }
function get_user_meta($id, $key, $single) { return $GLOBALS['meta'][$key] ?? ''; }
function wp_remote_post($url, $args) {
    $body = json_decode($args['body'], true);
    if (str_ends_with($url, '/v1/invoices')) { return ['code' => 201, 'body' => json_encode(['id' => str_repeat('c', 48), 'resource' => 'article', 'accessToken' => str_repeat('d', 43), 'confirmations' => 2])]; }
    if ($GLOBALS['scenario'] === 'outage') { return ['code' => 503, 'body' => '{}']; }
    return ['code' => 200, 'body' => json_encode(['authorized' => $GLOBALS['scenario'] !== 'unpaid'])];
}
function is_wp_error($value) { return false; }
function wp_remote_retrieve_response_code($value) { return $value['code']; }
function wp_remote_retrieve_body($value) { return $value['body']; }
function wp_send_json_success($value) { echo json_encode(['success' => true, 'data' => $value]); exit; }
function wp_send_json_error($value, $code) { echo json_encode(['success' => false, 'code' => $code, 'data' => $value]); exit; }
function wpautop($value) { return '<p>' . $value . '</p>'; } function wp_kses_post($value) { return $value; }
function shortcode_atts($defaults, $values, $tag) { return array_merge($defaults, $values); }
function esc_attr($value) { return htmlspecialchars((string) $value); } function esc_url($value) { return $value; }
function wp_enqueue_script(...$args) {} function plugins_url(...$args) { return '/checkout.js'; }
function admin_url($value) { return '/admin/' . $value; } function wp_create_nonce($action) { return 'test-nonce'; }
require __DIR__ . '/../../bloz-pay/bloz-pay.php';
$_POST = ['product' => 'article'];
if ($scenario === 'shortcode') {
    Pinco_Bloz_Pay::content_type();
    echo json_encode(['markup' => Pinco_Bloz_Pay::shortcode(['product' => 'article']), 'type' => $GLOBALS['type']]); exit;
}
if ($scenario === 'order') { Pinco_Bloz_Pay::order(); }
$save = new ReflectionMethod(Pinco_Bloz_Pay::class, 'save_receipt');
$save->invoke(null, 7, 'article', ['id' => str_repeat('c', 48), 'accessToken' => str_repeat('d', 43)]);
if ($scenario === 'tampered') { $meta['_bloz_pay_article'] = base64_encode(str_repeat('x', 60)); }
Pinco_Bloz_Pay::content();
