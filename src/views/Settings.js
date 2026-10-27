import { useState } from '@wordpress/element';
import { api } from '../api';
import { href } from '../router';
import { useLoad, Loading, ErrorBox, Button, useToast } from '../ui';
import { useMe } from '../App';

const ROLES = { owner: 'Ägare', admin: 'Administratör', member: 'Medlem', viewer: 'Läsare' };
const TABS = [
	[ '', 'Biodlingen' ],
	[ 'medlemmar', 'Medlemmar' ],
	[ 'logg', 'Ändringslogg' ],
	[ 'export', 'Export' ],
];

export default function Settings( { tab = '' } ) {
	return (
		<div className="nbs-page">
			<h1 className="nbs-h1">Inställningar</h1>
			<div className="nbs-tabs" role="tablist">
				{ TABS.map( ( [ k, l ] ) => (
					<a key={ k } role="tab" aria-selected={ tab === k } className={ `nbs-tab${ tab === k ? ' is-active' : '' }` } href={ href( 'installningar/' + k ) }>{ l }</a>
				) ) }
			</div>
			{ tab === 'medlemmar' && <Members /> }
			{ tab === 'logg' && <Audit /> }
			{ tab === 'export' && <Export /> }
			{ ! tab && <Org /> }
		</div>
	);
}

function Org() {
	const me = useMe();
	const toast = useToast();
	const [ name, setName ] = useState( me.org.name );
	const [ busy, setBusy ] = useState( false );
	const save = async () => {
		setBusy( true );
		try {
			await api( 'org', { method: 'PUT', body: { name } } );
			toast( 'Namnet sparades. Ladda om sidan för att se det i sidhuvudet.' );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
		setBusy( false );
	};
	return (
		<section className="nbs-card nbs-narrow">
			<div className="nbs-field">
				<label htmlFor="nbs-org">Biodlingens namn</label>
				<input id="nbs-org" type="text" value={ name } onChange={ ( e ) => setName( e.target.value ) } disabled={ ! me.can.manage } />
			</div>
			<p className="nbs-muted">Din roll: { ROLES[ me.org.role ] }. Version { me.version }.</p>
			{ me.can.manage && <Button onClick={ save } disabled={ busy || ! name.trim() }>Spara</Button> }
		</section>
	);
}

function Members() {
	const me = useMe();
	const toast = useToast();
	const [ members, error, reload ] = useLoad( () => api( 'org/members' ) );
	const [ email, setEmail ] = useState( '' );
	const [ role, setRole ] = useState( 'member' );
	const add = async ( e ) => {
		e.preventDefault();
		try {
			await api( 'org/members', { method: 'POST', body: { email, role } } );
			setEmail( '' );
			toast( 'Medlemmen lades till.' );
			reload();
		} catch ( e2 ) {
			toast( e2.message, 'error' );
		}
	};
	const remove = async ( m ) => {
		if ( ! window.confirm( `Ta bort ${ m.name } från biodlingen?` ) ) {
			return;
		}
		try {
			await api( 'org/members/' + m.user_id, { method: 'DELETE' } );
			reload();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	if ( error ) {
		return <ErrorBox error={ error } />;
	}
	if ( ! members ) {
		return <Loading />;
	}
	return (
		<section className="nbs-card">
			<table className="nbs-table">
				<thead><tr><th>Namn</th><th>E-post</th><th>Roll</th>{ me.can.manage && <th /> }</tr></thead>
				<tbody>
					{ members.map( ( m ) => (
						<tr key={ m.user_id }>
							<td>{ m.name }</td>
							<td data-label="E-post">{ m.email }</td>
							<td data-label="Roll">{ ROLES[ m.role ] || m.role }</td>
							{ me.can.manage && <td>{ m.user_id !== me.user.id && <Button variant="danger-link" small onClick={ () => remove( m ) }>Ta bort</Button> }</td> }
						</tr>
					) ) }
				</tbody>
			</table>
			{ me.can.manage && (
				<form className="nbs-inline-form" onSubmit={ add }>
					<div className="nbs-field">
						<label htmlFor="nbs-m-email">Lägg till befintlig användare (e-post)</label>
						<input id="nbs-m-email" type="email" value={ email } onChange={ ( e ) => setEmail( e.target.value ) } required />
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-m-role">Roll</label>
						<select id="nbs-m-role" value={ role } onChange={ ( e ) => setRole( e.target.value ) }>
							{ Object.entries( ROLES ).filter( ( [ k ] ) => k !== 'owner' || me.org.role === 'owner' ).map( ( [ k, l ] ) => <option key={ k } value={ k }>{ l }</option> ) }
						</select>
					</div>
					<Button type="submit">Lägg till</Button>
				</form>
			) }
			<p className="nbs-muted">Användaren måste finnas i WordPress (Användare → Lägg till ny). Läsare kan se allt men inte ändra.</p>
		</section>
	);
}

const ACTIONS = { create: 'skapade', update: 'ändrade', delete: 'tog bort' };
const ENTITIES = { list: 'listan', list_item: 'posten', org: 'biodlingen', member: 'medlem i' };

function Audit() {
	const [ rows, error ] = useLoad( () => api( 'audit?limit=100' ) );
	if ( error ) {
		return <ErrorBox error={ error } />;
	}
	if ( ! rows ) {
		return <Loading />;
	}
	return (
		<section className="nbs-card">
			{ rows.length === 0 && <p className="nbs-muted">Inga ändringar ännu.</p> }
			<ul className="nbs-log">
				{ rows.map( ( r ) => {
					const ch = r.changes || {};
					const what = ch.name ? ( Array.isArray( ch.name ) ? ch.name[ 1 ] : ch.name ) : '';
					const fields = r.action === 'update' ? Object.keys( ch ).filter( ( k ) => k !== 'name' ) : [];
					return (
						<li key={ r.id }>
							<time>{ new Date( r.created_at.replace( ' ', 'T' ) + 'Z' ).toLocaleString( 'sv-SE', { dateStyle: 'short', timeStyle: 'short' } ) }</time>
							<span><strong>{ r.user || 'System' }</strong> { ACTIONS[ r.action ] || r.action } { ENTITIES[ r.entity ] || r.entity } { what && <em>{ what }</em> }{ fields.length > 0 && ` (${ fields.join( ', ' ) })` }</span>
						</li>
					);
				} ) }
			</ul>
		</section>
	);
}

function Export() {
	const me = useMe();
	const toast = useToast();
	const download = async () => {
		try {
			const data = await api( 'export' );
			const blob = new Blob( [ JSON.stringify( data, null, 2 ) ], { type: 'application/json' } );
			const a = document.createElement( 'a' );
			a.href = URL.createObjectURL( blob );
			a.download = `skotsel-export-${ new Date().toISOString().slice( 0, 10 ) }.json`;
			a.click();
			URL.revokeObjectURL( a.href );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	return (
		<section className="nbs-card nbs-narrow">
			<p>Ladda ner all data för biodlingen som en JSON-fil. Bra som extra säkerhetskopia och för att flytta data. Export till Excel kommer i en senare fas.</p>
			{ me.can.manage ? <Button onClick={ download }>Ladda ner export</Button> : <p className="nbs-muted">Bara ägare och administratörer kan exportera.</p> }
		</section>
	);
}
