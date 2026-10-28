<?php
/**
 * Plugin Name: Nordiska Bin – Skötsel
 * Description: Skötsel-CMS för biodlingen: bigårdar, samhällen, drottningar, lager, skötselkort och driftplan med egna listor och fält. Bara för inloggade användare (sidan /skotsel/).
 * Version: 1.2.0
 * Author: Nordiska Bin
 * Plugin URI: https://github.com/jonathanothen/nb-skotsel
 * Text Domain: nb-skotsel
 * Requires at least: 6.4
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
	exit;
}

define('NBS_VERSION', '1.2.0');
define('NBS_FILE', __FILE__);
define('NBS_DIR', plugin_dir_path(__FILE__));
define('NBS_URL', plugin_dir_url(__FILE__));

require_once NBS_DIR . 'includes/class-nb-github-updater.php';
require_once NBS_DIR . 'includes/class-nbs-db.php';
require_once NBS_DIR . 'includes/class-nbs-auth.php';
require_once NBS_DIR . 'includes/class-nbs-repo.php';
require_once NBS_DIR . 'includes/class-nbs-lists.php';
require_once NBS_DIR . 'includes/class-nbs-entities.php';
require_once NBS_DIR . 'includes/class-nbs-events.php';
require_once NBS_DIR . 'includes/class-nbs-ops.php';
require_once NBS_DIR . 'includes/class-nbs-stock.php';
require_once NBS_DIR . 'includes/class-nbs-visits.php';
require_once NBS_DIR . 'includes/class-nbs-domain.php';
require_once NBS_DIR . 'includes/class-nbs-starter.php';
require_once NBS_DIR . 'includes/class-nbs-library.php';
require_once NBS_DIR . 'includes/class-nbs-updates.php';
require_once NBS_DIR . 'includes/class-nbs-hives.php';
require_once NBS_DIR . 'includes/class-nbs-rest.php';
require_once NBS_DIR . 'includes/class-nbs-app.php';

add_action('plugins_loaded', ['NBS_DB', 'maybe_upgrade']);
add_action('rest_api_init', ['NBS_Rest', 'routes']);
NBS_App::init();

new NB_GitHub_Updater(__FILE__, 'jonathanothen/nb-skotsel');

register_activation_hook(__FILE__, function () {
	NBS_DB::install();
	NBS_Auth::install_roles();
	NBS_Auth::ensure_default_org();
	NBS_App::add_rewrite();
	flush_rewrite_rules();
});
register_deactivation_hook(__FILE__, 'flush_rewrite_rules');
