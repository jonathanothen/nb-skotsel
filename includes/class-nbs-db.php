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

	const DB_VERSION = '10';

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
			treatment longtext NULL,
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
			foreach ($def['cols'] as $col => $kind) {
				self::ensure_column($t, $col, str_replace('NOT NULL', 'NULL', NBS_Entities::sql_type($kind)));
			}
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

		// ---- Fas 3: skötselkort (mallar), besök och kupkontroll per samhälle.
		$tpl = self::table('templates');
		dbDelta("CREATE TABLE $tpl (
			id char(36) NOT NULL,
			org_id char(36) NOT NULL,
			name varchar(190) NOT NULL,
			category_id char(36) NULL,
			purpose text NULL,
			steps longtext NULL,
			checklist longtext NULL,
			material longtext NULL,
			fields longtext NULL,
			sort int(11) NOT NULL DEFAULT 0,
			archived tinyint(1) NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			created_by bigint(20) unsigned NULL,
			PRIMARY KEY  (id),
			KEY org_id (org_id)
		) $c;");

		$visits = self::table('visits');
		dbDelta("CREATE TABLE $visits (
			id char(36) NOT NULL,
			org_id char(36) NOT NULL,
			template_id char(36) NULL,
			apiary_id char(36) NULL,
			visit_date date NOT NULL,
			status varchar(12) NOT NULL DEFAULT 'planned',
			start_time varchar(5) NULL,
			end_time varchar(5) NULL,
			checked longtext NULL,
			material longtext NULL,
			result varchar(12) NULL,
			deviation text NULL,
			followup tinyint(1) NOT NULL DEFAULT 0,
			followup_date date NULL,
			followup_done tinyint(1) NOT NULL DEFAULT 0,
			notes text NULL,
			batches longtext NULL,
			user_id bigint(20) unsigned NULL,
			done_at datetime NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY org_date (org_id,visit_date),
			KEY apiary (org_id,apiary_id),
			KEY status (org_id,status)
		) $c;");

		$insp = self::table('inspections');
		dbDelta("CREATE TABLE $insp (
			id char(36) NOT NULL,
			org_id char(36) NOT NULL,
			visit_id char(36) NOT NULL,
			colony_id char(36) NOT NULL,
			skipped tinyint(1) NOT NULL DEFAULT 0,
			data longtext NULL,
			note text NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY visit_colony (visit_id,colony_id),
			KEY colony (org_id,colony_id)
		) $c;");

		// dbDelta lägger inte alltid till nya kolumner i befintliga tabeller (t.ex. på SQLite).
		self::ensure_column($tpl, 'treatment', 'longtext NULL');

		update_option('nbs_db_version', self::DB_VERSION);
	}

	/** Lägger till en kolumn om den saknas. */
	private static function ensure_column($table, $column, $definition) {
		global $wpdb;
		$cols = $wpdb->get_col("SHOW COLUMNS FROM $table", 0); // phpcs:ignore
		if ($cols && !in_array($column, array_map('strtolower', $cols), true)) {
			$wpdb->query("ALTER TABLE $table ADD COLUMN $column $definition"); // phpcs:ignore
		}
	}

	public static function now() {
		return current_time('mysql', true);
	}
}
