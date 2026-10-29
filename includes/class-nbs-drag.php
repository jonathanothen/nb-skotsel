<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Dragkalendern (pluginet nb-dragkalender) i skötselsystemet. Växterna läses från dess
 * posttyp nb_drag. Inget läggs in automatiskt: biodlaren väljer själv de drag som finns vid
 * bigårdarna, och de blir rader i driftplanen (kind = drag, source = nbd:<slug>) med veckor
 * och vilka bigårdar de gäller.
 */
class NBS_Drag {

	public static function available() {
		return post_type_exists('nb_drag');
	}

	/** Alla växter i dragkalendern, sorterade efter när de börjar blomma. */
	public static function catalog() {
		if (!self::available()) {
			return ['available' => false, 'plants' => [], 'mine' => []];
		}
		$plants = [];
		foreach (get_posts(['post_type' => 'nb_drag', 'post_status' => 'publish', 'numberposts' => -1, 'orderby' => 'title', 'order' => 'ASC']) as $p) {
			$m        = function ($k) use ($p) {
				return get_post_meta($p->ID, '_nbd_' . $k, true);
			};
			$plants[] = [
				'slug'       => $m('slug') ?: $p->post_name,
				'name'       => $p->post_title,
				'latin'      => (string) $m('latin'),
				'week_start' => (int) $m('week_start'),
				'week_end'   => (int) $m('week_end'),
				'nectar'     => (int) $m('nectar'),
				'pollen'     => (int) $m('pollen'),
				'honeydew'   => (int) $m('honeydew'),
				'color'      => (string) $m('color'),
			];
		}
		usort($plants, function ($a, $b) {
			return [$a['week_start'], $a['name']] <=> [$b['week_start'], $b['name']];
		});
		// "Min dragkalender" som användaren sparat på webbplatsen.
		$mine = get_user_meta(get_current_user_id(), 'nbd_mina', true);
		return ['available' => true, 'plants' => $plants, 'mine' => is_array($mine) ? array_values($mine) : []];
	}
}
