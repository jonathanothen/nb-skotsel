<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Databastabeller. Alla rader har org_id så att flera biodlare kan använda samma
 * installation, och id är UUID (skapas i appen eller servern) för att stödja
 * offline-synk senare. Schemat uppgraderas med dbDelta när DB_VERSION höjs.
 */
class NBS_DB {

	const DB_VERSION = '3';

	public static function table($name) {
		global $wpdb;
		return $wpdb->prefix . 'nbs_' . $name;
	}

	public static function maybe_upgrade() {
		if (get_option('nbs_db_version') !== self::DB_VERSION) {
			self::install();
		}
	}

	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$c = $wpdb->get_charset_collate();

		$orgs    = self::table('orgs');
		$members = self::table('members');
		$lists   = self::table('lists');
		$items   = self::table('list_items');
		$audit   = self::table('audit');

		dbDelta("CREATE TABLE $orgs (
			id char(36) NOT NULL,
			name varchar(190) NOT NULL,
			settings longtext NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id)
		) $c;");

		dbDelta("CREATE TABLE $members (
			org_id char(36) NOT NULL,
			user_id bigint(20) unsigned NOT NULL,
			role varchar(20) NOT NULL DEFAULT 'member',
			created_at datetime NOT NULL,
			PRIMARY KEY  (org_id,user_id),
			KEY user_id (user_id)
		) $c;");

		dbDelta("CREATE TABLE $lists (
			id char(36) NOT NULL,
			org_id char(36) NOT NULL,
			list_key varchar(64) NOT NULL,
			name varchar(190) NOT NULL,
			description text NULL,
			kind varchar(20) NOT NULL DEFAULT 'custom',
			fields longtext NULL,
			sort int(11) NOT NULL DEFAULT 0,
			archived tinyint(1) NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			created_by bigint(20) unsigned NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY org_key (org_id,list_key)
		) $c;");

		dbDelta("CREATE TABLE $items (
			id char(36) NOT NULL,
			org_id char(36) NOT NULL,
			list_id char(36) NOT NULL,
			parent_id char(36) NULL,
			name varchar(190) NOT NULL,
			code varchar(64) NULL,
			color varchar(9) NULL,
			sort int(11) NOT NULL DEFAULT 0,
			active tinyint(1) NOT NULL DEFAULT 1,
			data longtext NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			created_by bigint(20) unsigned NULL,
			updated_by bigint(20) unsigned NULL,
			PRIMARY KEY  (id),
			KEY list_sort (list_id,sort),
			KEY org_id (org_id)
		) $c;");

		dbDelta("CREATE TABLE $audit (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			org_id char(36) NOT NULL,
			user_id bigint(20) unsigned NULL,
			entity varchar(32) NOT NULL,
			entity_id char(36) NOT NULL,
			action varchar(16) NOT NULL,
			changes longtext NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY entity (entity,entity_id),
			KEY org_time (org_id,created_at)
		) $c;");

		// ---- Fas 1: bigårdar, kupor, samhällen, drottningar och deras historik.
		// Kolumnerna byggs från NBS_Entities så att schema och validering hänger ihop.
		foreach (NBS_Entities::TYPES as $type => $def) {
			$t    = self::table($def['table']);
			$cols = '';
			foreach ($def['cols'] as $col => $kind) {
				$cols .= "\t\t\t$col " . NBS_Entities::sql_type($kind) . ",\n";
			}
			$keys = '';
			foreach ($def['index'] ?? [] as $col) {
				$keys .= ",\n\t\t\tKEY $col (org_id,$col)";
			}
			dbDelta("CREATE TABLE $t (
			id char(36) NOT NULL,
			org_id char(36) NOT NULL,
$cols			data longtext NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			created_by bigint(20) unsigned NULL,
			updated_by bigint(20) unsigned NULL,
			PRIMARY KEY  (id),
			KEY org_id (org_id)$keys
		) $c;");
		}

		$events = self::table('events');
		dbDelta("CREATE TABLE $events (
			id char(36) NOT NULL,
			org_id char(36) NOT NULL,
			event_date date NOT NULL,
			type varchar(24) NOT NULL,
			colony_id char(36) NULL,
			queen_id char(36) NULL,
			apiary_id char(36) NULL,
			from_id char(36) NULL,
			other_id char(36) NULL,
			data longtext NULL,
			note text NULL,
			created_at datetime NOT NULL,
			created_by bigint(20) unsigned NULL,
			PRIMARY KEY  (id),
			KEY colony (org_id,colony_id,event_date),
			KEY queen (org_id,queen_id,event_date),
			KEY apiary (org_id,apiary_id,event_date),
			KEY from_id (org_id,from_id)
		) $c;");

		// ---- Fas 2: lager. Varje rörelse är en rad i stock_tx (från plats → till plats);
		// stock är saldot per artikel och plats, som uppdateras i samma transaktion.
		$tx = self::table('stock_tx');
		dbDelta("CREATE TABLE $tx (
			id char(36) NOT NULL,
			org_id char(36) NOT NULL,
			batch_id char(36) NOT NULL,
			tx_date date NOT NULL,
			type varchar(16) NOT NULL,
			item_id char(36) NOT NULL,
			qty decimal(14,3) NOT NULL,
			unit_price decimal(12,2) NULL,
			from_type varchar(8) NULL,
			from_id char(36) NULL,
			to_type varchar(8) NULL,
			to_id char(36) NULL,
			colony_id char(36) NULL,
			apiary_id char(36) NULL,
			note text NULL,
			created_at datetime NOT NULL,
			created_by bigint(20) unsigned NULL,
			PRIMARY KEY  (id),
			KEY item (org_id,item_id,tx_date),
			KEY colony (org_id,colony_id),
			KEY apiary (org_id,apiary_id),
			KEY batch (org_id,batch_id),
			KEY tx_date (org_id,tx_date)
		) $c;");

		$stock = self::table('stock');
		dbDelta("CREATE TABLE $stock (
			org_id char(36) NOT NULL,
			item_id char(36) NOT NULL,
			loc_type varchar(8) NOT NULL,
			loc_id char(36) NOT NULL,
			qty decimal(14,3) NOT NULL DEFAULT 0,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (org_id,item_id,loc_type,loc_id),
			KEY loc (org_id,loc_type,loc_id)
		) $c;");

		update_option('nbs_db_version', self::DB_VERSION);
	}

	public static function now() {
		return current_time('mysql', true);
	}
}
