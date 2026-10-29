<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Egna listor (variabler): material, kuptyper, linjer, fodertyper, behandlingsmedel,
 * kategorier m.m. Varje lista har egna fält som användaren definierar, och fält av
 * typen "ref" pekar på en annan lista – så kopplas t.ex. ett material till ett
 * ramformat. Systemlistor kan inte tas bort (bara arkiveras), men får egna fält.
 */
class NBS_Lists {

	/** Varroamätningar som ett fält i ett skötselkort kan registrera (samma metoder som i Bihälsa). */
	const VARROA_MAPS = ['varroa:Naturligt nedfall', 'varroa:Alkoholtvätt', 'varroa:Sockerrullning', 'varroa:Drönaryngel'];

	const FIELD_TYPES = ['text', 'textarea', 'number', 'scale', 'select', 'multiselect', 'bool', 'date', 'ref', 'color', 'url'];

	private static function t($name) {
		return NBS_DB::table($name);
	}

	// ------------------------------------------------------------ Fält

	/** Rensar och validerar en fältdefinition från klienten. */
	public static function sanitize_fields($fields) {
		$out  = [];
		$seen = [];
		foreach ((array) $fields as $f) {
			$label = sanitize_text_field($f['label'] ?? '');
			$type  = in_array($f['type'] ?? '', self::FIELD_TYPES, true) ? $f['type'] : 'text';
			if ($label === '') {
				continue;
			}
			$key = sanitize_key($f['key'] ?? '') ?: sanitize_key(preg_replace('/[\s\-]+/', '_', remove_accents(strtolower($label))));
			$key = substr($key ?: 'falt', 0, 40);
			$base = $key;
			$n    = 2;
			while (isset($seen[$key])) {
				$key = $base . '_' . $n++;
			}
			$seen[$key] = true;
			$field = ['key' => $key, 'label' => $label, 'type' => $type];
			if (!empty($f['unit'])) {
				$field['unit'] = sanitize_text_field($f['unit']);
			}
			if (!empty($f['help'])) {
				$field['help'] = sanitize_text_field($f['help']);
			}
			if (!empty($f['required'])) {
				$field['required'] = true;
			}
			if (in_array($type, ['select', 'multiselect'], true)) {
				$opts = array_values(array_filter(array_map('sanitize_text_field', (array) ($f['options'] ?? []))));
				$field['options'] = array_values(array_unique($opts));
			}
			if ($type === 'ref') {
				$field['ref'] = sanitize_key($f['ref'] ?? '');
			}
			if ($type === 'scale') {
				$field['min'] = isset($f['min']) && is_numeric($f['min']) ? max(0, (int) $f['min']) : 1;
				$field['max'] = isset($f['max']) && is_numeric($f['max']) ? min(10, max($field['min'] + 1, (int) $f['max'])) : 5;
			}
			// Skötselkort: fältet kan uppdatera samhällets styrka eller bli en bihälsopost när besöket
			// avslutas (varroamätning med metod, behandlingsmedel, förväntad avdödning).
			$maps = (string) ($f['maps'] ?? '');
			if (in_array($type, ['number', 'scale'], true) && $maps === 'strength') {
				$field['maps'] = 'strength';
			}
			if ($type === 'number' && (in_array($maps, self::VARROA_MAPS, true) || $maps === 'kill')) {
				$field['maps'] = $maps;
			}
			if ($type === 'ref' && $maps === 'treatment') {
				$field['maps'] = 'treatment';
			}
			// Ja/nej-fält: ikryssat registrerar behandlingsmedlet (treat:<id>).
			if ($type === 'bool' && preg_match('/^(treat|split):[0-9a-f-]{36}$/', $maps)) {
				$field['maps'] = $maps;
			}
			if ($type === 'number') {
				foreach (['min', 'max', 'step'] as $k) {
					if (isset($f[$k]) && $f[$k] !== '' && is_numeric($f[$k])) {
						$field[$k] = $f[$k] + 0;
					}
				}
			}
			$out[] = $field;
		}
		return $out;
	}

	/** Rensar värden för en post enligt listans fält. Okända nycklar tas bort. */
	public static function sanitize_values($fields, $values, &$errors = []) {
		$out = [];
		foreach ($fields as $f) {
			$k = $f['key'];
			$v = $values[$k] ?? null;
			if ($v === null || $v === '' || $v === []) {
				if (!empty($f['required'])) {
					$errors[] = sprintf('Fältet "%s" måste fyllas i.', $f['label']);
				}
				continue;
			}
			switch ($f['type']) {
				case 'number':
					if (!is_numeric(str_replace(',', '.', (string) $v))) {
						$errors[] = sprintf('"%s" måste vara ett tal.', $f['label']);
						continue 2;
					}
					$v = (float) str_replace(',', '.', (string) $v);
					$v = floor($v) == $v ? (int) $v : $v;
					break;
				case 'scale':
					if (!is_numeric($v) || (int) $v < ($f['min'] ?? 1) || (int) $v > ($f['max'] ?? 5)) {
						$errors[] = sprintf('"%s" måste vara mellan %d och %d.', $f['label'], $f['min'] ?? 1, $f['max'] ?? 5);
						continue 2;
					}
					$v = (int) $v;
					break;
				case 'bool':
					$v = (bool) $v;
					break;
				case 'select':
					$v = sanitize_text_field($v);
					if (!in_array($v, $f['options'] ?? [], true)) {
						$errors[] = sprintf('Ogiltigt val i "%s".', $f['label']);
						continue 2;
					}
					break;
				case 'multiselect':
					$v = array_values(array_intersect(array_map('sanitize_text_field', (array) $v), $f['options'] ?? []));
					break;
				case 'date':
					$v = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $v) ? $v : null;
					break;
				case 'ref':
					$v = NBS_Repo::is_uuid($v) ? strtolower($v) : null;
					break;
				case 'color':
					$v = NBS_Repo::color($v);
					break;
				case 'url':
					$v = esc_url_raw($v);
					break;
				case 'textarea':
					$v = sanitize_textarea_field($v);
					break;
				default:
					$v = sanitize_text_field($v);
			}
			if ($v !== null && $v !== '') {
				$out[$k] = $v;
			}
		}
		return $out;
	}

	// ------------------------------------------------------------ Listor

	private static function row_to_list($r) {
		return [
			'id'          => $r['id'],
			'key'         => $r['list_key'],
			'name'        => $r['name'],
			'description' => (string) $r['description'],
			'kind'        => $r['kind'],
			'fields'      => NBS_Repo::unjson($r['fields']),
			'sort'        => (int) $r['sort'],
			'archived'    => (bool) $r['archived'],
			'count'       => isset($r['item_count']) ? (int) $r['item_count'] : null,
			'updated_at'  => $r['updated_at'],
		];
	}

	public static function all($org_id) {
		global $wpdb;
		$l = self::t('lists');
		$i = self::t('list_items');
		$rows = $wpdb->get_results($wpdb->prepare(
			"SELECT l.*, (SELECT COUNT(*) FROM $i i WHERE i.list_id = l.id) AS item_count FROM $l l WHERE l.org_id = %s ORDER BY l.sort, l.name",
			$org_id
		), ARRAY_A);
		return array_map([__CLASS__, 'row_to_list'], $rows);
	}

	public static function get($org_id, $id) {
		global $wpdb;
		$r = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t('lists') . ' WHERE org_id = %s AND id = %s', $org_id, $id), ARRAY_A);
		return $r ? self::row_to_list($r) : null;
	}

	public static function get_by_key($org_id, $key) {
		global $wpdb;
		$r = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t('lists') . ' WHERE org_id = %s AND list_key = %s', $org_id, $key), ARRAY_A);
		return $r ? self::row_to_list($r) : null;
	}

	private static function unique_key($org_id, $wanted) {
		$key  = substr(sanitize_key(preg_replace('/[\s\-]+/', '_', remove_accents(strtolower($wanted)))) ?: 'lista', 0, 60);
		$base = $key;
		$n    = 2;
		while (self::get_by_key($org_id, $key)) {
			$key = $base . '_' . $n++;
		}
		return $key;
	}

	public static function create($org_id, $data, $kind = 'custom') {
		global $wpdb;
		$name = sanitize_text_field($data['name'] ?? '');
		if ($name === '') {
			return new WP_Error('nbs_name', 'Listan behöver ett namn.', ['status' => 400]);
		}
		$id  = NBS_Repo::id($data['id'] ?? null);
		$now = NBS_DB::now();
		$row = [
			'id'          => $id,
			'org_id'      => $org_id,
			'list_key'    => self::unique_key($org_id, $data['key'] ?? $name),
			'name'        => $name,
			'description' => sanitize_textarea_field($data['description'] ?? ''),
			'kind'        => $kind === 'system' ? 'system' : 'custom',
			'fields'      => NBS_Repo::json(self::sanitize_fields($data['fields'] ?? [])),
			'sort'        => (int) ($data['sort'] ?? 100),
			'archived'    => 0,
			'created_at'  => $now,
			'updated_at'  => $now,
			'created_by'  => get_current_user_id() ?: null,
		];
		$wpdb->insert(self::t('lists'), $row);
		NBS_Repo::audit('list', $id, 'create', ['name' => $name]);
		return self::get($org_id, $id);
	}

	public static function update($org_id, $id, $data) {
		global $wpdb;
		$before = self::get($org_id, $id);
		if (!$before) {
			return new WP_Error('nbs_404', 'Listan finns inte.', ['status' => 404]);
		}
		$set = [];
		if (isset($data['name'])) {
			$name = sanitize_text_field($data['name']);
			if ($name === '') {
				return new WP_Error('nbs_name', 'Listan behöver ett namn.', ['status' => 400]);
			}
			$set['name'] = $name;
		}
		if (isset($data['description'])) {
			$set['description'] = sanitize_textarea_field($data['description']);
		}
		if (isset($data['fields'])) {
			$set['fields'] = NBS_Repo::json(self::sanitize_fields($data['fields']));
		}
		if (isset($data['sort'])) {
			$set['sort'] = (int) $data['sort'];
		}
		if (isset($data['archived'])) {
			$set['archived'] = $data['archived'] ? 1 : 0;
		}
		if (!$set) {
			return $before;
		}
		$set['updated_at'] = NBS_DB::now();
		$wpdb->update(self::t('lists'), $set, ['id' => $id, 'org_id' => $org_id]);
		$after = self::get($org_id, $id);
		NBS_Repo::audit('list', $id, 'update', NBS_Repo::diff(
			['name' => $before['name'], 'description' => $before['description'], 'fields' => $before['fields'], 'archived' => $before['archived']],
			['name' => $after['name'], 'description' => $after['description'], 'fields' => $after['fields'], 'archived' => $after['archived']]
		));
		return $after;
	}

	public static function delete($org_id, $id) {
		global $wpdb;
		$list = self::get($org_id, $id);
		if (!$list) {
			return new WP_Error('nbs_404', 'Listan finns inte.', ['status' => 404]);
		}
		if ($list['kind'] === 'system') {
			return new WP_Error('nbs_system', 'Grundlistor kan inte tas bort, men de kan arkiveras.', ['status' => 400]);
		}
		$wpdb->delete(self::t('list_items'), ['list_id' => $id, 'org_id' => $org_id]);
		$wpdb->delete(self::t('lists'), ['id' => $id, 'org_id' => $org_id]);
		NBS_Repo::audit('list', $id, 'delete', ['name' => $list['name']]);
		return true;
	}

	// ------------------------------------------------------------ Poster

	private static function row_to_item($r) {
		return [
			'id'         => $r['id'],
			'list_id'    => $r['list_id'],
			'parent_id'  => $r['parent_id'],
			'name'       => $r['name'],
			'code'       => (string) $r['code'],
			'color'      => $r['color'],
			'sort'       => (int) $r['sort'],
			'active'     => (bool) $r['active'],
			'data'       => (object) NBS_Repo::unjson($r['data']),
			'updated_at' => $r['updated_at'],
		];
	}

	public static function items($org_id, $list_id) {
		global $wpdb;
		$rows = $wpdb->get_results($wpdb->prepare(
			'SELECT * FROM ' . self::t('list_items') . ' WHERE org_id = %s AND list_id = %s ORDER BY sort, name',
			$org_id,
			$list_id
		), ARRAY_A);
		return array_map([__CLASS__, 'row_to_item'], $rows);
	}

	public static function get_item($org_id, $id) {
		global $wpdb;
		$r = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t('list_items') . ' WHERE org_id = %s AND id = %s', $org_id, $id), ARRAY_A);
		return $r ? self::row_to_item($r) : null;
	}

	/** Alla poster i alla listor som "ref"-fält kan peka på: [list_key => [ [id, name], ... ]]. */
	public static function ref_options($org_id) {
		global $wpdb;
		$l = self::t('lists');
		$i = self::t('list_items');
		$rows = $wpdb->get_results($wpdb->prepare(
			"SELECT l.list_key, i.id, i.name, i.color, i.active FROM $i i JOIN $l l ON l.id = i.list_id WHERE i.org_id = %s ORDER BY i.sort, i.name",
			$org_id
		), ARRAY_A);
		$out = [];
		foreach ($rows as $r) {
			$out[$r['list_key']][] = ['id' => $r['id'], 'name' => $r['name'], 'color' => $r['color'], 'active' => (bool) $r['active']];
		}
		return $out;
	}

	public static function save_item($org_id, $list_id, $data, $item_id = null) {
		global $wpdb;
		$list = self::get($org_id, $list_id);
		if (!$list) {
			return new WP_Error('nbs_404', 'Listan finns inte.', ['status' => 404]);
		}
		$before = $item_id ? self::get_item($org_id, $item_id) : null;
		if ($item_id && (!$before || $before['list_id'] !== $list_id)) {
			return new WP_Error('nbs_404', 'Posten finns inte.', ['status' => 404]);
		}
		$name = isset($data['name']) ? sanitize_text_field($data['name']) : ($before['name'] ?? '');
		if ($name === '') {
			return new WP_Error('nbs_name', 'Posten behöver ett namn.', ['status' => 400]);
		}
		$errors = [];
		$values = isset($data['data'])
			? self::sanitize_values($list['fields'], (array) $data['data'], $errors)
			: (array) ($before['data'] ?? []);
		if ($errors) {
			return new WP_Error('nbs_invalid', implode(' ', $errors), ['status' => 400]);
		}
		$row = [
			'name'       => $name,
			'code'       => isset($data['code']) ? substr(sanitize_text_field($data['code']), 0, 64) : ($before['code'] ?? ''),
			'color'      => array_key_exists('color', $data) ? NBS_Repo::color($data['color']) : ($before['color'] ?? null),
			'active'     => isset($data['active']) ? ($data['active'] ? 1 : 0) : (int) ($before['active'] ?? 1),
			'parent_id'  => array_key_exists('parent_id', $data) ? (NBS_Repo::is_uuid($data['parent_id']) ? $data['parent_id'] : null) : ($before['parent_id'] ?? null),
			'data'       => NBS_Repo::json((object) $values),
			'updated_at' => NBS_DB::now(),
			'updated_by' => get_current_user_id() ?: null,
		];
		if ($before) {
			$wpdb->update(self::t('list_items'), $row, ['id' => $item_id, 'org_id' => $org_id]);
			$after = self::get_item($org_id, $item_id);
			NBS_Repo::audit('list_item', $item_id, 'update', NBS_Repo::diff(
				['name' => $before['name'], 'code' => $before['code'], 'color' => $before['color'], 'active' => $before['active'], 'data' => (array) $before['data']],
				['name' => $after['name'], 'code' => $after['code'], 'color' => $after['color'], 'active' => $after['active'], 'data' => (array) $after['data']]
			));
			return $after;
		}
		$id    = NBS_Repo::id($data['id'] ?? null);
		$max   = (int) $wpdb->get_var($wpdb->prepare('SELECT MAX(sort) FROM ' . self::t('list_items') . ' WHERE list_id = %s', $list_id));
		$row  += [
			'id'         => $id,
			'org_id'     => $org_id,
			'list_id'    => $list_id,
			'sort'       => isset($data['sort']) ? (int) $data['sort'] : $max + 10,
			'created_at' => NBS_DB::now(),
			'created_by' => get_current_user_id() ?: null,
		];
		$wpdb->insert(self::t('list_items'), $row);
		NBS_Repo::audit('list_item', $id, 'create', ['name' => $name, 'list' => $list['key']]);
		return self::get_item($org_id, $id);
	}

	public static function delete_item($org_id, $id) {
		global $wpdb;
		$item = self::get_item($org_id, $id);
		if (!$item) {
			return new WP_Error('nbs_404', 'Posten finns inte.', ['status' => 404]);
		}
		$wpdb->delete(self::t('list_items'), ['id' => $id, 'org_id' => $org_id]);
		NBS_Repo::audit('list_item', $id, 'delete', ['name' => $item['name']]);
		return true;
	}

	public static function reorder($org_id, $list_id, $ids) {
		global $wpdb;
		$sort = 10;
		foreach ((array) $ids as $id) {
			if (NBS_Repo::is_uuid($id)) {
				$wpdb->update(self::t('list_items'), ['sort' => $sort], ['id' => $id, 'list_id' => $list_id, 'org_id' => $org_id]);
				$sort += 10;
			}
		}
		return self::items($org_id, $list_id);
	}
}
