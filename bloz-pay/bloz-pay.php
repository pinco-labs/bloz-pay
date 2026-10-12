<?php
/**
 * Plugin Name: BLOZ Pay — Experimental
 * Description: Experimental direct-wallet article access through a local BLOZ Pay merchant backend.
 * Version: 0.1.1
 * Requires PHP: 8.1
 * Author: Pinco Labs
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
 * Update URI: https://github.com/pinco-labs/bloz-pay
 */
if (!defined('ABSPATH')) { exit; }

final class Pinco_Bloz_Pay {
    public static function init(): void {
        add_action('init', [self::class, 'content_type']);
        add_action('add_meta_boxes', [self::class, 'meta_box']);
        add_action('save_post_bloz_pay_content', [self::class, 'save_product']);
        add_shortcode('bloz_pay', [self::class, 'shortcode']);
        add_action('wp_ajax_bloz_pay_order', [self::class, 'order']);
        add_action('wp_ajax_bloz_pay_status', [self::class, 'status']);
        add_action('wp_ajax_bloz_pay_content', [self::class, 'content']);
    }
    public static function content_type(): void {
        register_post_type('bloz_pay_content', [
            'label' => 'BLOZ Pay · contenuti privati', 'public' => false,
            'publicly_queryable' => false, 'exclude_from_search' => true,
            'show_ui' => true, 'show_in_rest' => false, 'show_in_nav_menus' => false,
            'has_archive' => false, 'rewrite' => false, 'query_var' => false,
            'supports' => ['title', 'editor'],
            'capabilities' => ['edit_posts' => 'manage_options', 'edit_others_posts' => 'manage_options',
                'publish_posts' => 'manage_options', 'read_private_posts' => 'manage_options',
                'delete_posts' => 'manage_options', 'create_posts' => 'manage_options',
                'edit_private_posts' => 'manage_options', 'edit_published_posts' => 'manage_options',
                'delete_private_posts' => 'manage_options', 'delete_published_posts' => 'manage_options',
                'delete_others_posts' => 'manage_options'],
            'map_meta_cap' => true,
        ]);
    }
    public static function meta_box(): void {
        add_meta_box('bloz-pay-product', 'Prodotto nel catalogo BLOZ Pay', function ($post) {
            wp_nonce_field('bloz_pay_product', 'bloz_pay_product_nonce');
            echo '<p>Identificativo del catalogo merchant, per esempio article. Un solo contenuto per prodotto.</p>';
            echo '<input name="bloz_pay_product" value="' . esc_attr(get_post_meta($post->ID, '_bloz_pay_product', true)) . '" pattern="[a-z0-9-]{1,64}" maxlength="64">';
        }, 'bloz_pay_content');
    }
    public static function save_product(int $id): void {
        if (!current_user_can('manage_options') || wp_is_post_revision($id) ||
            (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) ||
            !isset($_POST['bloz_pay_product_nonce']) ||
            !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['bloz_pay_product_nonce'])), 'bloz_pay_product')) { return; }
        $product = sanitize_text_field(wp_unslash($_POST['bloz_pay_product'] ?? ''));
        if (preg_match('/^[a-z0-9-]{1,64}$/D', $product)) { update_post_meta($id, '_bloz_pay_product', $product); }
        else { delete_post_meta($id, '_bloz_pay_product'); }
    }
    public static function shortcode(array $attributes = []): string {
        $attributes = shortcode_atts(['product' => ''], $attributes, 'bloz_pay');
        $product = $attributes['product'];
        if (!preg_match('/^[a-z0-9-]{1,64}$/D', $product)) { return '<p>Prodotto BLOZ Pay non configurato.</p>'; }
        if (!is_user_logged_in()) { return '<p><a href="' . esc_url(wp_login_url(get_permalink())) . '">Accedi per acquistare il contenuto con BLOZ.</a></p>'; }
        // Personalized nonces and content must never enter shared caches.
        if (!defined('DONOTCACHEPAGE')) { define('DONOTCACHEPAGE', true); }
        nocache_headers();
        wp_enqueue_script('bloz-pay', plugins_url('checkout.js', __FILE__), [], '0.1.1', true);
        return '<section class="bloz-pay" data-product="' . esc_attr($product) . '" data-url="' . esc_url(admin_url('admin-ajax.php')) . '" data-nonce="' . esc_attr(wp_create_nonce('bloz_pay')) . '">' .
            '<p>Pagamento diretto al commerciante in BLOZ. Plugin sperimentale.</p>' .
            '<button type="button" data-command="order">Crea o riprendi richiesta</button> ' .
            '<button type="button" data-command="status">Verifica pagamento</button> ' .
            '<button type="button" data-command="content">Apri contenuto</button>' .
            '<p class="bloz-pay-status" role="status"></p><dl class="bloz-pay-details"></dl><div class="bloz-pay-content"></div></section>';
    }
    private static function context(): array {
        nocache_headers();
        if (!is_user_logged_in() || !check_ajax_referer('bloz_pay', 'nonce', false)) { wp_send_json_error(['message' => 'Accesso non autorizzato.'], 403); }
        $product = sanitize_text_field(wp_unslash($_POST['product'] ?? ''));
        if (!preg_match('/^[a-z0-9-]{1,64}$/D', $product)) { wp_send_json_error(['message' => 'Prodotto non valido.'], 400); }
        $posts = get_posts(['post_type' => 'bloz_pay_content', 'post_status' => ['publish', 'private'],
            'posts_per_page' => 2, 'meta_key' => '_bloz_pay_product', 'meta_value' => $product]);
        if (count($posts) !== 1) { wp_send_json_error(['message' => 'Contenuto non disponibile o configurazione ambigua.'], 404); }
        return [get_current_user_id(), $product, $posts[0]];
    }
    private static function merchant(string $path, array $body): array {
        if (!defined('BLOZ_PAY_MERCHANT_URL') || !defined('BLOZ_PAY_MERCHANT_KEY') ||
            !preg_match('#^http://127\.0\.0\.1:[0-9]{1,5}$#D', BLOZ_PAY_MERCHANT_URL)) { throw new RuntimeException('Backend locale non configurato.'); }
        $response = wp_remote_post(BLOZ_PAY_MERCHANT_URL . $path, [
            'timeout' => 30, 'redirection' => 0, 'limit_response_size' => 16384,
            'headers' => ['Content-Type' => 'application/json', 'Authorization' => 'Bearer ' . BLOZ_PAY_MERCHANT_KEY],
            'body' => wp_json_encode($body),
        ]);
        if (is_wp_error($response) || wp_remote_retrieve_response_code($response) < 200 || wp_remote_retrieve_response_code($response) >= 300) { throw new RuntimeException('Verifica indisponibile. Riprendi la stessa richiesta, senza inviare un altro pagamento.'); }
        $result = json_decode(wp_remote_retrieve_body($response), true, 16, JSON_THROW_ON_ERROR);
        if (!is_array($result)) { throw new RuntimeException('Risposta non valida.'); }
        return $result;
    }
    private static function receipt_key(): string {
        if (!defined('BLOZ_PAY_WP_RECEIPT_KEY') || !preg_match('/^[a-f0-9]{64}$/D', BLOZ_PAY_WP_RECEIPT_KEY) || !function_exists('openssl_encrypt')) { throw new RuntimeException('Chiave di cifratura locale non configurata.'); }
        return hex2bin(BLOZ_PAY_WP_RECEIPT_KEY);
    }
    private static function save_receipt(int $user, string $product, array $receipt): void {
        $iv = random_bytes(12); $tag = '';
        $cipher = openssl_encrypt(wp_json_encode($receipt), 'aes-256-gcm', self::receipt_key(), OPENSSL_RAW_DATA, $iv, $tag, $user . ':' . $product);
        if ($cipher === false) { throw new RuntimeException('Salvataggio ricevuta non riuscito.'); }
        $value = base64_encode($iv . $tag . $cipher);
        update_user_meta($user, '_bloz_pay_' . $product, $value);
        if (get_user_meta($user, '_bloz_pay_' . $product, true) !== $value) { throw new RuntimeException('Salvataggio ricevuta non riuscito.'); }
    }
    private static function receipt(int $user, string $product): array {
        $value = base64_decode((string) get_user_meta($user, '_bloz_pay_' . $product, true), true);
        if ($value === false || strlen($value) < 29) { throw new RuntimeException('Crea prima una richiesta.'); }
        $plain = openssl_decrypt(substr($value, 28), 'aes-256-gcm', self::receipt_key(), OPENSSL_RAW_DATA, substr($value, 0, 12), substr($value, 12, 16), $user . ':' . $product);
        if ($plain === false) { throw new RuntimeException('Ricevuta non recuperabile.'); }
        return json_decode($plain, true, 16, JSON_THROW_ON_ERROR);
    }
    public static function order(): void {
        [$user, $product] = self::context();
        try {
            // Stable request namespace requires an immutable per-installation ID in wp-config.
            if (!defined('BLOZ_PAY_WP_SITE_ID') || !preg_match('/^[a-f0-9]{32}$/D', BLOZ_PAY_WP_SITE_ID)) { throw new RuntimeException('Identificativo del sito non configurato.'); }
            self::receipt_key();
            $id = hash('sha256', BLOZ_PAY_WP_SITE_ID . ':' . $user . ':' . $product);
            $invoice = self::merchant('/v1/invoices', ['product' => $product, 'requestId' => $id]);
            if (!preg_match('/^[a-f0-9]{48}$/D', $invoice['id'] ?? '') || !preg_match('/^[-_A-Za-z0-9]{43}$/D', $invoice['accessToken'] ?? '') || ($invoice['confirmations'] ?? 0) < 2) { throw new RuntimeException('Fattura non valida.'); }
            self::save_receipt($user, $product, $invoice);
            unset($invoice['accessToken']); wp_send_json_success($invoice);
        } catch (Throwable $error) { wp_send_json_error(['message' => $error->getMessage()], 503); }
    }
    public static function status(): void {
        [$user, $product] = self::context();
        try { $receipt = self::receipt($user, $product); wp_send_json_success(self::merchant('/v1/status', ['id' => $receipt['id']])); }
        catch (Throwable $error) { wp_send_json_error(['message' => $error->getMessage()], 503); }
    }
    public static function content(): void {
        [$user, $product, $post] = self::context();
        try {
            $receipt = self::receipt($user, $product);
            $result = self::merchant('/v1/authorize', ['id' => $receipt['id'], 'accessToken' => $receipt['accessToken'], 'product' => $product]);
            if (($result['authorized'] ?? false) !== true) { wp_send_json_error(['message' => 'Pagamento confermato necessario.'], 403); }
            // No shortcodes or arbitrary content filters: private text is delivered only here.
            wp_send_json_success(['content' => wp_kses_post(wpautop($post->post_content))]);
        } catch (Throwable $error) { wp_send_json_error(['message' => $error->getMessage()], 503); }
    }
}
Pinco_Bloz_Pay::init();
