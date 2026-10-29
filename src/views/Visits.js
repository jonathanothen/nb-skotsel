import { useState, useEffect, useRef } from '@wordpress/element';
import { api, uuid } from '../api';
import { href, go } from '../router';
import { useMe } from '../App';
import { useRegister, COLONY_ACTIVE, today, fmtDate } from '../register';
import { useLoad, Loading, ErrorBox, Button, Modal, Empty, useToast } from '../ui';
import { FieldInput, formatValue } from '../fields';
import FieldDefs, { withIds, cleanFields } from '../FieldDefs';
import { QueenBadge } from '../reg-ui';
import { useStock, fmtQty, unit } from '../stock';

const PER = { colony: 'per samhälle', apiary: 'per bigård', visit: 'per besök' };
const STATUS = { planned: 'Planerat', ongoing: 'Pågår', done: 'Klart' };
const byCode = ( a, b ) => String( a.code ).localeCompare( String( b.code ), 'sv', { numeric: true } );
const weekday = ( d ) => new Date( d + 'T12:00:00' ).toLocaleDateString( 'sv-SE', { weekday: 'long', day: 'numeric', month: 'long' } );

/** Lägger bigårdarna i körplaneringen och öppnar den. */
function planRoute( apiaryIds ) {
	try {
		const cur = JSON.parse( localStorage.getItem( 'nbs_rutt' ) || '{}' ) || {};
		localStorage.setItem( 'nbs_rutt', JSON.stringify( { ...cur, stops: apiaryIds } ) );
	} catch ( e ) {
		/* privat läge */
	}
	go( 'bigardar/rutt' );
}

export default function Visits( { route } ) {
	const reg = useRegister();
	const [ templates, error, reload ] = useLoad( () => api( 'templates' ) );
	if ( reg.error || error ) {
		return <div className="nbs-page"><ErrorBox error={ reg.error || error } /></div>;
	}
	if ( reg.loading || ! templates ) {
		return <Loading />;
	}
	const [ a, b, c ] = route;
	if ( a === 'kort' && b ) {
		return c === 'utskrift' ? <PrintCard templateId={ b } templates={ templates } /> : <TemplateEditor key={ b } id={ b } templates={ templates } onSaved={ reload } />;
	}
	if ( a && a !== 'kort' && a !== 'gjorda' && a !== 'uppfoljning' ) {
		return b === 'utskrift' ? <PrintCard visitId={ a } templates={ templates } /> : <VisitPage key={ a } id={ a } />;
	}
	return <VisitList tab={ a || 'kommande' } templates={ templates } reloadTemplates={ reload } />;
}

/* ------------------------------------------------------------------ Lista */

function VisitList( { tab, templates, reloadTemplates } ) {
	const reg = useRegister();
	const me = useMe();
	const toast = useToast();
	const [ planning, setPlanning ] = useState( false );
	const [ stamp, setStamp ] = useState( 0 );
	const qs = tab === 'gjorda' ? 'status=done&limit=200' : tab === 'uppfoljning' ? 'followup=1' : 'open=1';
	const [ visits, error, reload ] = useLoad( () => ( tab === 'kort' ? Promise.resolve( [] ) : api( 'visits?' + qs ) ), [ qs, stamp ] );
	const tpl = Object.fromEntries( templates.map( ( t ) => [ t.id, t ] ) );
	const color = ( t ) => ( t && reg.itemColor( t.category_id ) ) || '#A8741A';

	const importExamples = async () => {
		try {
			const r = await api( 'templates/examples', { method: 'POST' } );
			toast( r.added ? `${ r.added } skötselkort lades till.` : 'Korten fanns redan.' );
			reloadTemplates();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	const linkExamples = async () => {
		try {
			const r = await api( 'templates/link-examples', { method: 'POST' } );
			toast( r.linked ? `${ r.linked } skötselkort kopplades till behandlingar och varroamätningar.` : 'Standardkorten var redan kopplade.' );
			reloadTemplates();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	const markDone = async ( v ) => {
		try {
			await api( 'visits/' + v.id, { method: 'PUT', body: { followup_done: true } } );
			toast( 'Uppföljningen markerades som klar.' );
			reload();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};

	const tabs = (
		<nav className="nbs-subtabs" aria-label="Besök">
			<a href={ href( 'besok' ) } className={ tab === 'kommande' ? 'is-active' : '' }>Kommande</a>
			<a href={ href( 'besok/gjorda' ) } className={ tab === 'gjorda' ? 'is-active' : '' }>Gjorda</a>
			<a href={ href( 'besok/uppfoljning' ) } className={ tab === 'uppfoljning' ? 'is-active' : '' }>Uppföljning</a>
			<a href={ href( 'besok/kort' ) } className={ tab === 'kort' ? 'is-active' : '' }>Skötselkort</a>
		</nav>
	);

	const row = ( v ) => {
		const t = tpl[ v.template_id ];
		const ap = reg.apiary[ v.apiary_id ];
		const n = ap ? reg.coloniesIn( ap.id ).length : 0;
		return (
			<a key={ v.id } className="nbs-visit-row" href={ href( 'besok/' + v.id ) } style={ { '--nbs-accent': color( t ) } }>
				<span className="nbs-visit-main">
					<strong>{ t ? t.name : 'Besök' }</strong>
					<span>{ ap ? ap.name : 'Ingen bigård' }</span>
				</span>
				<span className="nbs-visit-meta">
					{ tab === 'gjorda' || tab === 'uppfoljning' ? fmtDate( v.date ) : null }
					<span className={ `nbs-vstatus is-${ v.status }` }>{ STATUS[ v.status ] }</span>
					<span className="nbs-muted">{ v.inspected || 0 }{ v.status !== 'done' ? `/${ n }` : '' } samhällen</span>
					{ v.result === 'action' && <span className="nbs-badge is-low">Åtgärd</span> }
				</span>
			</a>
		);
	};

	let body = null;
	if ( tab === 'kort' ) {
		body = <TemplateList templates={ templates } onImport={ importExamples } onLink={ linkExamples } />;
	} else if ( ! visits ) {
		body = error ? <ErrorBox error={ error } /> : <Loading />;
	} else if ( tab === 'kommande' ) {
		const days = {};
		visits.forEach( ( v ) => ( days[ v.date ] = days[ v.date ] || [] ).push( v ) );
		body = visits.length ? (
			Object.entries( days ).map( ( [ d, list ] ) => (
				<section key={ d } className="nbs-group">
					<h2 className="nbs-h3">
						<span className={ d < today() ? 'nbs-warn-inline' : '' }>{ d === today() ? 'I dag' : weekday( d ) }</span>
						<span className="nbs-count">{ list.length }</span>
						{ list.length > 1 && <button type="button" className="nbs-group-link nbs-link-btn" onClick={ () => planRoute( [ ...new Set( list.map( ( v ) => v.apiary_id ).filter( Boolean ) ) ] ) }>Planera körning →</button> }
					</h2>
					<div className="nbs-visit-list">{ list.map( row ) }</div>
				</section>
			) )
		) : (
			<Empty title="Inga planerade besök">
				<p>{ templates.length ? 'Planera ett besök: välj skötselkort, datum och bigårdar.' : 'Börja med skötselkorten – lägg in exemplen från driftplanen eller gör egna.' }</p>
				{ templates.length ? me.can.write && <Button onClick={ () => setPlanning( true ) }>+ Planera besök</Button> : <a className="nbs-btn is-primary" href={ href( 'besok/kort' ) }>Till skötselkorten</a> }
			</Empty>
		);
	} else if ( tab === 'uppfoljning' ) {
		body = visits.length ? (
			<div className="nbs-visit-list">
				{ visits.map( ( v ) => (
					<div key={ v.id } className="nbs-followup">
						{ row( v ) }
						<div className="nbs-followup-body">
							<p>{ v.deviation || 'Ingen avvikelse beskriven.' }</p>
							<p className="nbs-muted">{ v.followup_date ? `Följ upp senast ${ fmtDate( v.followup_date ) }` : 'Inget datum satt' }</p>
							{ me.can.write && <Button small variant="ghost" onClick={ () => markDone( v ) }>Markera som åtgärdad</Button> }
						</div>
					</div>
				) ) }
			</div>
		) : <Empty title="Inget att följa upp"><p>Besök med avvikelser som behöver följas upp hamnar här.</p></Empty>;
	} else {
		body = visits.length ? <div className="nbs-visit-list">{ visits.map( row ) }</div> : <Empty title="Inga gjorda besök ännu" />;
	}

	return (
		<div className="nbs-page">
			<header className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">Besök</h1>
					<p className="nbs-muted">Skötselkort, kupkontroll i fält och material som dras från lagret.</p>
				</div>
				<div className="nbs-row-actions">
					{ me.can.write && tab === 'kort' && <a className="nbs-btn is-ghost" href={ href( 'besok/kort/ny' ) }>+ Nytt skötselkort</a> }
					{ me.can.write && templates.length > 0 && <Button onClick={ () => setPlanning( true ) }>+ Planera besök</Button> }
				</div>
			</header>
			{ tabs }
			{ body }
			{ planning && (
				<PlanModal
					templates={ templates.filter( ( t ) => ! t.archived ) }
					onClose={ () => setPlanning( false ) }
					onDone={ ( ids ) => {
						setPlanning( false );
						if ( ids.length === 1 ) {
							go( 'besok/' + ids[ 0 ] );
						} else {
							go( 'besok' );
							setStamp( ( s ) => s + 1 );
						}
					} }
				/>
			) }
		</div>
	);
}

function PlanModal( { templates, onClose, onDone } ) {
	const reg = useRegister();
	const toast = useToast();
	const [ templateId, setTemplateId ] = useState( templates[ 0 ] ? templates[ 0 ].id : '' );
	const [ date, setDate ] = useState( today() );
	const [ picked, setPicked ] = useState( [] );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	const groups = {};
	reg.apiaries.filter( ( a ) => a.active ).forEach( ( a ) => ( groups[ a.route_id || '' ] = groups[ a.route_id || '' ] || [] ).push( a ) );
	const toggle = ( id ) => setPicked( ( p ) => ( p.includes( id ) ? p.filter( ( x ) => x !== id ) : [ ...p, id ] ) );
	const run = async () => {
		setBusy( true );
		setErr( null );
		try {
			const r = await api( 'visits', { method: 'POST', body: { template_id: templateId, date, apiary_ids: picked } } );
			toast( r.ids.length > 1 ? `${ r.ids.length } besök planerades.` : 'Besöket planerades.' );
			onDone( r.ids );
		} catch ( e ) {
			setErr( e );
			setBusy( false );
		}
	};
	return (
		<Modal
			title="Planera besök"
			onClose={ onClose }
			footer={
				<>
					<span className="nbs-spacer" />
					<Button variant="ghost" onClick={ onClose }>Avbryt</Button>
					<Button onClick={ run } disabled={ busy || ! templateId || ! picked.length }>{ busy ? 'Sparar…' : picked.length > 1 ? `Planera ${ picked.length } besök` : 'Planera' }</Button>
				</>
			}
		>
			<div className="nbs-form">
				<ErrorBox error={ err } />
				<div className="nbs-form-row">
					<div className="nbs-field">
						<label htmlFor="nbs-pl-tpl">Skötselkort</label>
						<select id="nbs-pl-tpl" value={ templateId } onChange={ ( e ) => setTemplateId( e.target.value ) }>
							{ templates.map( ( t ) => <option key={ t.id } value={ t.id }>{ t.name }</option> ) }
						</select>
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-pl-date">Datum</label>
						<input id="nbs-pl-date" type="date" value={ date } onChange={ ( e ) => setDate( e.target.value ) } />
					</div>
				</div>
				<p className="nbs-muted">Ett besök skapas per bigård. Välj gärna en hel slinga.</p>
				{ Object.entries( groups ).map( ( [ rid, arr ] ) => (
					<div key={ rid || 'none' } className="nbs-route-group">
						<div className="nbs-route-group-head">
							<strong>{ rid ? reg.itemName( rid ) : 'Utan slinga' }</strong>
							<button type="button" className="nbs-link-btn" onClick={ () => setPicked( ( p ) => [ ...p, ...arr.map( ( a ) => a.id ).filter( ( id ) => ! p.includes( id ) ) ] ) }>Välj alla</button>
						</div>
						{ arr.map( ( a ) => (
							<label key={ a.id } className={ `nbs-check-pill${ picked.includes( a.id ) ? ' is-on' : '' }` }>
								<input type="checkbox" checked={ picked.includes( a.id ) } onChange={ () => toggle( a.id ) } />{ a.name } <span className="nbs-muted">({ reg.coloniesIn( a.id ).length })</span>
							</label>
						) ) }
					</div>
				) ) }
			</div>
		</Modal>
	);
}

/* ------------------------------------------------------------------ Skötselkort */

function TemplateList( { templates, onImport, onLink } ) {
	const reg = useRegister();
	const me = useMe();
	const [ showArchived, setShowArchived ] = useState( false );
	const list = templates.filter( ( t ) => showArchived || ! t.archived );
	return (
		<>
			{ me.can.manage && templates.length < 7 && (
				<div className="nbs-alert nbs-alert-info">
					Korten från driftplanen (dödskontroll, vårgenomgång, drönarram, skattning, slutskattning och Samuel, oxalsyra och invintring, invintringskontroll) kan läggas in som exempel och ändras fritt. <button type="button" className="nbs-link-btn" onClick={ onImport }>Lägg in exempelkorten</button>
				</div>
			) }
			{ me.can.manage && templates.length > 0 && (
				<p className="nbs-muted">Standardkorten (oxalsyra, drönarram, Samuel …) kan kopplas till behandlingarna och varroamodellen. Fält du redan kopplat lämnas orörda. <button type="button" className="nbs-link-btn" onClick={ onLink }>Koppla standardkorten</button></p>
			) }
			{ list.length === 0 ? (
				<Empty title="Inga skötselkort ännu">
					<p>Ett skötselkort är en mall för ett besök: syfte, rutin, checklista, material från lagret och de uppgifter du vill fylla i för varje samhälle.</p>
				</Empty>
			) : (
				<div className="nbs-cards">
					{ list.map( ( t ) => (
						<a key={ t.id } className={ `nbs-apiary-card${ t.archived ? ' is-inactive' : '' }` } href={ href( 'besok/kort/' + t.id ) } style={ { '--nbs-accent': reg.itemColor( t.category_id ) || '#A8741A' } }>
							<span className="nbs-apiary-type">{ reg.itemName( t.category_id ) || 'Skötselkort' }</span>
							<strong className="nbs-apiary-name">{ t.name }</strong>
							<span className="nbs-muted nbs-apiary-sum">{ t.steps.length } rutinsteg · { t.checklist.length } kontrollpunkter · { t.fields.length } kupkontrollfält · { t.material.filter( ( m ) => m.item_id ).length } från lagret</span>
							<span className="nbs-muted nbs-apiary-sum">{ t.visits ? `Använt i ${ t.visits } besök` : 'Inte använt än' }</span>
						</a>
					) ) }
				</div>
			) }
			{ templates.some( ( t ) => t.archived ) && <label className="nbs-inline-check nbs-mt"><input type="checkbox" checked={ showArchived } onChange={ ( e ) => setShowArchived( e.target.checked ) } /> Visa arkiverade</label> }
		</>
	);
}

function TemplateEditor( { id, templates, onSaved } ) {
	const reg = useRegister();
	const me = useMe();
	const toast = useToast();
	const [ stock ] = useStock();
	const orig = id === 'ny' ? null : templates.find( ( t ) => t.id === id );
	const [ form, setForm ] = useState( () => ( {
		name: orig ? orig.name : '',
		category_id: orig ? orig.category_id || '' : '',
		purpose: orig ? orig.purpose : '',
		steps: orig ? orig.steps.map( ( s ) => ( { ...s, _id: uuid() } ) ) : [ { title: '', text: '', _id: uuid() } ],
		checklist: orig ? orig.checklist.map( ( c ) => ( { text: c, _id: uuid() } ) ) : [],
		material: orig ? orig.material.map( ( m ) => ( { ...m, qty: m.qty ?? '', _id: uuid() } ) ) : [],
		treatment: ( ( orig && orig.treatment ) || [] ).map( ( t ) => ( { ...t, kill: t.kill ?? '', _id: uuid() } ) ),
	} ) );
	// Behandlingsmedlen med sina fält (avdödning, kopplad lagerartikel).
	const [ treatList ] = useLoad( () => api( 'lists' ).then( ( ls ) => {
		const l = ls.find( ( x ) => x.key === 'behandling' );
		return l ? api( 'lists/' + l.id ).then( ( r ) => r.items ) : [];
	} ) );
	const [ fields, setFields ] = useState( () => withIds( orig ? orig.fields : [ { key: 'styrka', label: 'Styrka', type: 'scale', min: 1, max: 5, maps: 'strength' } ] ) );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	if ( id !== 'ny' && ! orig ) {
		return <div className="nbs-page"><a className="nbs-back" href={ href( 'besok/kort' ) }>← Skötselkort</a><Empty title="Kortet finns inte" /></div>;
	}
	const set = ( k, v ) => setForm( ( f ) => ( { ...f, [ k ]: v } ) );
	const listOps = ( key ) => ( {
		upd: ( i, patch ) => set( key, form[ key ].map( ( x, j ) => ( j === i ? { ...x, ...patch } : x ) ) ),
		del: ( i ) => set( key, form[ key ].filter( ( _, j ) => j !== i ) ),
		move: ( i, d ) => {
			const a = [ ...form[ key ] ];
			const j = i + d;
			if ( j >= 0 && j < a.length ) {
				[ a[ i ], a[ j ] ] = [ a[ j ], a[ i ] ];
				set( key, a );
			}
		},
	} );
	const S = listOps( 'steps' );
	const C = listOps( 'checklist' );
	const M = listOps( 'material' );
	const refLists = [ ...reg.lists.filter( ( l ) => ! l.archived ) ];
	const letter = ( i ) => String.fromCharCode( 65 + i );

	const body = ( extra = {} ) => ( {
		name: form.name,
		category_id: form.category_id || null,
		purpose: form.purpose,
		steps: form.steps.map( ( { title, text } ) => ( { title, text } ) ),
		checklist: form.checklist.map( ( c ) => c.text ),
		material: form.material.map( ( { _id, ...m } ) => m ),
		fields: cleanFields( fields ),
		treatment: form.treatment.filter( ( t ) => t.id ).map( ( t ) => ( { id: t.id, kill: t.kill === '' || t.kill === null ? null : t.kill, broodless: !! t.broodless } ) ),
		...extra,
	} );
	const save = async ( extra, msg ) => {
		setBusy( true );
		setErr( null );
		try {
			const saved = orig ? await api( 'templates/' + orig.id, { method: 'PUT', body: body( extra ) } ) : await api( 'templates', { method: 'POST', body: { ...body( extra ), id: uuid() } } );
			toast( msg || 'Skötselkortet sparades.' );
			await onSaved();
			setBusy( false );
			if ( ! orig ) {
				go( 'besok/kort/' + saved.id );
			}
		} catch ( e ) {
			setErr( e );
			setBusy( false );
		}
	};
	const copy = async () => {
		try {
			const saved = await api( 'templates', { method: 'POST', body: { ...body(), name: form.name + ' (kopia)', id: uuid() } } );
			await onSaved();
			toast( 'Kortet kopierades.' );
			go( 'besok/kort/' + saved.id );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	const remove = async () => {
		if ( ! window.confirm( `Ta bort skötselkortet "${ orig.name }"?` ) ) {
			return;
		}
		try {
			await api( 'templates/' + orig.id, { method: 'DELETE' } );
			await onSaved();
			toast( 'Kortet togs bort.' );
			go( 'besok/kort' );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};

	const rowBtns = ( ops, i, len, label ) => (
		<span className="nbs-route-btns">
			<button type="button" className="nbs-icon-btn" onClick={ () => ops.move( i, -1 ) } disabled={ i === 0 } aria-label={ `Flytta ${ label } upp` }>↑</button>
			<button type="button" className="nbs-icon-btn" onClick={ () => ops.move( i, 1 ) } disabled={ i === len - 1 } aria-label={ `Flytta ${ label } ned` }>↓</button>
			<button type="button" className="nbs-icon-btn" onClick={ () => ops.del( i ) } aria-label={ `Ta bort ${ label }` }>×</button>
		</span>
	);

	return (
		<div className="nbs-page nbs-tpl-editor">
			<a className="nbs-back" href={ href( 'besok/kort' ) }>← Skötselkort</a>
			<header className="nbs-page-head">
				<div>
					<p className="nbs-eyebrow">Skötselkort{ orig && orig.archived ? ' · arkiverat' : '' }</p>
					<h1 className="nbs-h1">{ form.name || 'Nytt skötselkort' }</h1>
				</div>
				<div className="nbs-row-actions">
					{ orig && <a className="nbs-btn is-ghost" href={ href( `besok/kort/${ orig.id }/utskrift` ) }>Skriv ut</a> }
					{ orig && me.can.write && <Button variant="ghost" onClick={ copy }>Kopiera</Button> }
					{ me.can.write && <Button onClick={ () => save() } disabled={ busy || ! form.name.trim() }>{ busy ? 'Sparar…' : 'Spara' }</Button> }
				</div>
			</header>
			<ErrorBox error={ err } />

			<section className="nbs-card">
				<h2 className="nbs-h2">1. Syfte</h2>
				<div className="nbs-form-row">
					<div className="nbs-field">
						<label htmlFor="nbs-t-name">Namn <span className="nbs-req">*</span></label>
						<input id="nbs-t-name" type="text" value={ form.name } onChange={ ( e ) => set( 'name', e.target.value ) } placeholder="T.ex. Vårgenomgång" />
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-t-cat">Kategori</label>
						<select id="nbs-t-cat" value={ form.category_id } onChange={ ( e ) => set( 'category_id', e.target.value ) }>
							<option value="">– Ingen –</option>
							{ ( reg.refs.kategorier || [] ).map( ( c ) => <option key={ c.id } value={ c.id }>{ c.name }</option> ) }
						</select>
					</div>
				</div>
				<div className="nbs-field">
					<label htmlFor="nbs-t-purpose">Syfte och resultat</label>
					<textarea id="nbs-t-purpose" rows={ 3 } value={ form.purpose } onChange={ ( e ) => set( 'purpose', e.target.value ) } />
				</div>
			</section>

			<CardTreatment form={ form } set={ set } treatList={ treatList } stock={ stock } />

			<section className="nbs-card">
				<h2 className="nbs-h2">2. Material</h2>
				<p className="nbs-muted">Material kopplat till en lagerartikel dras från lagret när besöket avslutas (mängden kan ändras i fält). Rader utan artikel är påminnelser om vad som ska med.</p>
				{ form.material.map( ( m, i ) => (
					<div key={ m._id } className="nbs-mat-row">
						<select value={ m.item_id || '' } onChange={ ( e ) => {
							const it = stock && stock.item[ e.target.value ];
							M.upd( i, { item_id: e.target.value || null, label: m.label || ( it ? it.name : '' ) } );
						} } aria-label="Lagerartikel">
							<option value="">Påminnelse (inte i lagret)</option>
							{ stock && stock.items.map( ( it ) => <option key={ it.id } value={ it.id }>{ it.name }</option> ) }
						</select>
						<input type="text" value={ m.label } onChange={ ( e ) => M.upd( i, { label: e.target.value } ) } placeholder="Text på kortet" aria-label="Text på kortet" />
						{ m.item_id && (
							<>
								<input type="text" inputMode="decimal" className="nbs-mat-qty" value={ m.qty } onChange={ ( e ) => M.upd( i, { qty: e.target.value } ) } placeholder="Mängd" aria-label="Mängd" />
								<span className="nbs-muted">{ stock && unit( stock.item[ m.item_id ] ) }</span>
								<select value={ m.per } onChange={ ( e ) => M.upd( i, { per: e.target.value } ) } aria-label="Per">
									{ Object.entries( PER ).map( ( [ k, l ] ) => <option key={ k } value={ k }>{ l }</option> ) }
								</select>
								<select value={ m.kind } onChange={ ( e ) => M.upd( i, { kind: e.target.value } ) } aria-label="Vad händer">
									<option value="consume">förbrukas</option>
									<option value="move">{ m.per === 'colony' ? 'till kupan' : 'till bigården' }</option>
								</select>
							</>
						) }
						{ rowBtns( M, i, form.material.length, 'materialraden' ) }
					</div>
				) ) }
				<Button small variant="ghost" onClick={ () => set( 'material', [ ...form.material, { _id: uuid(), item_id: null, label: '', qty: '', per: 'colony', kind: 'consume' } ] ) }>+ Material</Button>
			</section>

			<section className="nbs-card">
				<h2 className="nbs-h2">3. Rutinbeskrivning</h2>
				{ form.steps.map( ( s, i ) => (
					<div key={ s._id } className="nbs-step-row">
						<span className="nbs-rn">{ letter( i ) }</span>
						<div className="nbs-step-body">
							<input type="text" value={ s.title } onChange={ ( e ) => S.upd( i, { title: e.target.value } ) } placeholder="Rubrik, t.ex. Yngelkontroll" aria-label={ `Rubrik steg ${ letter( i ) }` } />
							<textarea rows={ 2 } value={ s.text } onChange={ ( e ) => S.upd( i, { text: e.target.value } ) } placeholder="Hur det går till" aria-label={ `Beskrivning steg ${ letter( i ) }` } />
						</div>
						{ rowBtns( S, i, form.steps.length, 'steget' ) }
					</div>
				) ) }
				<Button small variant="ghost" onClick={ () => set( 'steps', [ ...form.steps, { _id: uuid(), title: '', text: '' } ] ) }>+ Rutinsteg</Button>
			</section>

			<section className="nbs-card">
				<h2 className="nbs-h2">4. Checklista</h2>
				{ form.checklist.map( ( c, i ) => (
					<div key={ c._id } className="nbs-check-row">
						<span className="nbs-rn">{ i + 1 }</span>
						<input type="text" value={ c.text } onChange={ ( e ) => C.upd( i, { text: e.target.value } ) } aria-label={ `Kontrollpunkt ${ i + 1 }` } />
						{ rowBtns( C, i, form.checklist.length, 'punkten' ) }
					</div>
				) ) }
				<Button small variant="ghost" onClick={ () => set( 'checklist', [ ...form.checklist, { _id: uuid(), text: '' } ] ) }>+ Kontrollpunkt</Button>
			</section>

			<section className="nbs-card">
				<h2 className="nbs-h2">5. Kupkontroll</h2>
				<p className="nbs-muted">Uppgifterna som fylls i för varje samhälle. Typen <em>Skala</em> ger stora knappar (t.ex. styrka 1–5) och <em>Ja/nej</em> två knappar. Under <em>När besöket avslutas</em> kopplas fältet vidare: styrka, varroamätning (syns i Bihälsa och varroamodellen) eller behandling – ett ja/nej-fält som kryssas i registrerar behandlingen på samhället.</p>
				<div className="nbs-form">
					<FieldDefs fields={ fields } setFields={ setFields } refLists={ refLists } allowMaps treatments={ treatList || [] } />
				</div>
			</section>

			{ orig && me.can.write && (
				<div className="nbs-row-actions nbs-mt">
					<Button variant="link" onClick={ () => save( { archived: ! orig.archived }, orig.archived ? 'Kortet återställdes.' : 'Kortet arkiverades.' ) }>{ orig.archived ? 'Återställ från arkiv' : 'Arkivera' }</Button>
					{ me.can.manage && ! orig.visits && <Button variant="danger-link" onClick={ remove }>Ta bort</Button> }
				</div>
			) }
		</div>
	);
}

/* ------------------------------------------------------------------ Ett besök i fält */

/** Standardmaterial för ett besök: från kortet, med plats där artikeln finns. */
function defaultMaterial( tpl, stock, apiaryId ) {
	return ( tpl ? tpl.material : [] )
		.filter( ( m ) => m.item_id && stock.item[ m.item_id ] )
		.map( ( m ) => {
			const there = ( stock.bal[ m.item_id ] || [] ).filter( ( b ) => b.qty > 0 && ( b.type === 'store' || ( b.type === 'apiary' && b.id === apiaryId ) ) );
			const pick = there.find( ( b ) => b.type === 'apiary' ) || there.find( ( b ) => b.type === 'store' ) || ( stock.stores[ 0 ] && { type: 'store', id: stock.stores[ 0 ].id } );
			return { item_id: m.item_id, label: m.label, qty: m.qty ?? '', per: m.per, kind: m.kind, from: pick ? { type: pick.type, id: pick.id } : null, skip: m.qty === null || m.qty === undefined || m.qty === '' };
		} );
}

function VisitPage( { id } ) {
	const reg = useRegister();
	const me = useMe();
	const toast = useToast();
	const [ stock, , reloadStock ] = useStock();
	const [ v, setV ] = useState( null );
	const [ err, setErr ] = useState( null );
	const [ saveState, setSaveState ] = useState( 'saved' );
	const [ confirming, setConfirming ] = useState( false );
	const [ busy, setBusy ] = useState( false );
	const timer = useRef();
	const pending = useRef( {} );

	// Osparade ändringar ligger kvar i telefonen (localStorage) tills servern har tagit emot dem,
	// även om appen stängs utan täckning.
	const DRAFT = 'nbs_visit_draft_' + id;
	const saveDraft = () => {
		try {
			if ( Object.keys( pending.current ).length ) {
				localStorage.setItem( DRAFT, JSON.stringify( pending.current ) );
			} else {
				localStorage.removeItem( DRAFT );
			}
		} catch ( e ) {
			/* privat läge */
		}
	};

	useEffect( () => {
		let draft = null;
		try {
			draft = JSON.parse( localStorage.getItem( DRAFT ) || 'null' );
		} catch ( e ) {
			draft = null;
		}
		// Skickar det som ligger i kö; försöker igen tills det går igenom.
		const push = () => {
			const body = pending.current;
			if ( ! Object.keys( body ).length ) {
				return;
			}
			setSaveState( 'saving' );
			api( 'visits/' + id, { method: 'PUT', body } ).then(
				( r ) => {
					pending.current = {};
					saveDraft();
					setSaveState( 'saved' );
					setV( ( x ) => ( x ? { ...x, status: r.status } : x ) );
				},
				() => {
					setSaveState( 'error' );
					timer.current = setTimeout( push, 8000 );
				}
			);
		};
		api( 'visits/' + id ).then( ( visit ) => {
			if ( draft && visit.status !== 'done' ) {
				const ins = Object.fromEntries( ( visit.inspections || [] ).map( ( i ) => [ i.colony_id, i ] ) );
				( draft.inspections || [] ).forEach( ( i ) => ( ins[ i.colony_id ] = i ) );
				const { inspections, ...rest } = draft;
				visit = { ...visit, ...rest, inspections: Object.values( ins ) };
				pending.current = draft;
				push();
			}
			setV( visit );
		}, setErr );
		window.addEventListener( 'online', push );
		return () => {
			clearTimeout( timer.current );
			window.removeEventListener( 'online', push );
		};
	}, [ id ] ); // eslint-disable-line react-hooks/exhaustive-deps

	// Material fylls i från kortet första gången (när lagret har laddats).
	useEffect( () => {
		if ( v && stock && v.material === null && v.status !== 'done' ) {
			const m = defaultMaterial( v.template, stock, v.apiary_id );
			setV( ( x ) => ( { ...x, material: m } ) );
			// Sparas med nästa ändring (eller när besöket avslutas).
			pending.current = { material: m, ...pending.current };
		}
	}, [ v && v.id, stock ] ); // eslint-disable-line react-hooks/exhaustive-deps

	if ( err ) {
		return <div className="nbs-page"><a className="nbs-back" href={ href( 'besok' ) }>← Besök</a><ErrorBox error={ err } /></div>;
	}
	if ( ! v || ! stock ) {
		return <Loading />;
	}
	const done = v.status === 'done';
	const tpl = v.template || { name: 'Besök', fields: [], steps: [], checklist: [], material: [], purpose: '' };
	const ap = reg.apiary[ v.apiary_id ];
	const insp = Object.fromEntries( ( v.inspections || [] ).map( ( i ) => [ i.colony_id, i ] ) );
	// Samhällena i bigården, plus de som redan kontrollerats (om något flyttats).
	const colonies = [ ...reg.activeColonies.filter( ( c ) => c.apiary_id === v.apiary_id ), ...Object.keys( insp ).map( ( cid ) => reg.colony[ cid ] ).filter( ( c ) => c && ( c.apiary_id !== v.apiary_id || ! COLONY_ACTIVE.includes( c.status ) ) ) ].sort( byCode );
	const hasData = ( c ) => insp[ c.id ] && ! insp[ c.id ].skipped && ( Object.keys( insp[ c.id ].data || {} ).length > 0 || insp[ c.id ].note );
	const inspected = colonies.filter( hasData );
	const reminders = tpl.material.filter( ( m ) => ! m.item_id );

	// Sparar ändringar efter en kort paus (eller direkt med flush).
	const queue = ( patch ) => {
		pending.current = { ...pending.current, ...patch };
		saveDraft();
		setSaveState( 'dirty' );
		clearTimeout( timer.current );
		timer.current = setTimeout( flush, 1200 );
	};
	const flush = async () => {
		clearTimeout( timer.current );
		const body = pending.current;
		if ( ! Object.keys( body ).length ) {
			return true;
		}
		pending.current = {};
		setSaveState( 'saving' );
		try {
			const r = await api( 'visits/' + id, { method: 'PUT', body } );
			saveDraft();
			setV( ( x ) => ( { ...x, status: r.status } ) );
			setSaveState( r.warnings ? 'warn' : 'saved' );
			if ( r.warnings ) {
				toast( r.warnings.join( ' ' ), 'error' );
			}
			return true;
		} catch ( e ) {
			pending.current = { ...body, ...pending.current };
			saveDraft();
			setSaveState( 'error' );
			timer.current = setTimeout( flush, 5000 );
			return false;
		}
	};
	const update = ( patch ) => {
		setV( ( x ) => ( { ...x, ...patch } ) );
		queue( patch );
	};
	// Uppdateringarna utgår från senaste tillståndet, så att snabba tryck inte skriver över varandra.
	const setInsp = ( cid, patch ) =>
		setV( ( x ) => {
			const cur = ( x.inspections || [] ).find( ( i ) => i.colony_id === cid ) || { colony_id: cid, skipped: false, data: {}, note: '' };
			const next = { ...cur, ...patch, data: patch.data ? { ...( cur.data || {} ), ...patch.data } : cur.data };
			const others = ( pending.current.inspections || [] ).filter( ( i ) => i.colony_id !== cid );
			queue( { inspections: [ ...others, next ] } );
			return { ...x, inspections: [ ...( x.inspections || [] ).filter( ( i ) => i.colony_id !== cid ), next ] };
		} );
	const toggleCheck = ( i ) =>
		setV( ( x ) => {
			const cur = x.checked || [];
			const checked = cur.includes( i ) ? cur.filter( ( n ) => n !== i ) : [ ...cur, i ];
			queue( { checked } );
			return { ...x, checked };
		} );
	const setMat = ( i, patch ) => update( { material: v.material.map( ( m, j ) => ( j === i ? { ...m, ...patch } : m ) ) } );

	const complete = async () => {
		setBusy( true );
		if ( v.material ) {
			pending.current = { material: v.material, ...pending.current };
		}
		const ok = await flush();
		if ( ! ok ) {
			setBusy( false );
			toast( 'Ändringarna kunde inte sparas. Kontrollera uppkopplingen och försök igen.', 'error' );
			return;
		}
		try {
			const r = await api( `visits/${ id }/complete`, { method: 'POST' } );
			setV( r );
			setConfirming( false );
			reg.reload();
			reloadStock();
			toast( 'Besöket är avslutat och sparat i historiken.' );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
		setBusy( false );
	};
	const reopen = async () => {
		if ( ! window.confirm( 'Öppna besöket igen? Lagerbokningarna och historiken från besöket ångras tills du avslutar det på nytt.' ) ) {
			return;
		}
		try {
			setV( await api( `visits/${ id }/reopen`, { method: 'POST' } ) );
			reg.reload();
			reloadStock();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	const remove = async () => {
		if ( ! window.confirm( done ? 'Ta bort besöket? Lagerbokningar och historik ångras.' : 'Ta bort besöket?' ) ) {
			return;
		}
		try {
			await api( 'visits/' + id, { method: 'DELETE' } );
			toast( 'Besöket togs bort.' );
			go( 'besok' );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	const now = () => new Date().toTimeString().slice( 0, 5 );
	const matTotal = ( m ) => ( m.per === 'colony' ? ( parseFloat( String( m.qty ).replace( ',', '.' ) ) || 0 ) * inspected.length : parseFloat( String( m.qty ).replace( ',', '.' ) ) || 0 );
	const fromOptions = ( m ) => {
		const opts = stock.stores.map( ( s ) => ( { type: 'store', id: s.id, name: s.name } ) );
		if ( ap ) {
			opts.push( { type: 'apiary', id: ap.id, name: ap.name + ' (bigården)' } );
		}
		return opts.map( ( o ) => ( { ...o, qty: stock.at( m.item_id, o ) } ) );
	};

	return (
		<div className={ `nbs-page nbs-visit${ done ? ' is-done' : '' }` }>
			<a className="nbs-back" href={ href( 'besok' ) }>← Besök</a>
			<header className="nbs-page-head">
				<div>
					<p className="nbs-eyebrow">{ tpl.name } · <span className={ `nbs-vstatus is-${ v.status }` }>{ STATUS[ v.status ] }</span></p>
					<h1 className="nbs-h1">{ ap ? ap.name : 'Ingen bigård' }</h1>
					<p className="nbs-muted">{ weekday( v.date ) }{ v.start_time && ` · ${ v.start_time }${ v.end_time ? '–' + v.end_time : '' }` } · { inspected.length } av { colonies.length } samhällen kontrollerade</p>
				</div>
				<div className="nbs-row-actions">
					<span className={ `nbs-savestate is-${ saveState }` } aria-live="polite">{ { saved: 'Sparat', dirty: 'Ändrat…', saving: 'Sparar…', error: 'Ej sparat – försöker igen', warn: 'Sparat med varningar' }[ saveState ] }</span>
					{ ap && ap.lat !== null && <a className="nbs-btn is-ghost" href={ `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${ ap.lat },${ ap.lng }` } target="_blank" rel="noopener noreferrer">Kör hit</a> }
					<a className="nbs-btn is-ghost" href={ href( `besok/${ id }/utskrift` ) }>Skriv ut kortet</a>
				</div>
			</header>

			{ ! done && (
				<section className="nbs-card nbs-visit-times">
					<div className="nbs-field">
						<label htmlFor="nbs-v-date">Datum</label>
						<input id="nbs-v-date" type="date" value={ v.date } onChange={ ( e ) => update( { date: e.target.value } ) } />
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-v-start">Start</label>
						<div className="nbs-inline-form">
							<input id="nbs-v-start" type="time" value={ v.start_time } onChange={ ( e ) => update( { start_time: e.target.value } ) } />
							{ ! v.start_time && <Button small variant="ghost" onClick={ () => update( { start_time: now() } ) }>Nu</Button> }
						</div>
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-v-end">Slut</label>
						<div className="nbs-inline-form">
							<input id="nbs-v-end" type="time" value={ v.end_time } onChange={ ( e ) => update( { end_time: e.target.value } ) } />
							{ v.start_time && ! v.end_time && <Button small variant="ghost" onClick={ () => update( { end_time: now() } ) }>Nu</Button> }
						</div>
					</div>
				</section>
			) }

			<details className="nbs-card nbs-fold" open={ ! done && v.status === 'planned' }>
				<summary><h2 className="nbs-h2">Syfte och rutin</h2></summary>
				{ tpl.purpose && <p>{ tpl.purpose }</p> }
				{ reminders.length > 0 && (
					<>
						<h3 className="nbs-h3">Att ta med</h3>
						<ul className="nbs-pack">{ reminders.map( ( m, i ) => <li key={ i }>{ m.label }</li> ) }</ul>
					</>
				) }
				{ tpl.steps.map( ( s, i ) => (
					<div key={ i } className="nbs-step">
						<h3 className="nbs-h3">{ String.fromCharCode( 65 + i ) }. { s.title }</h3>
						<p>{ s.text }</p>
					</div>
				) ) }
			</details>

			{ tpl.checklist.length > 0 && (
				<section className="nbs-card">
					<h2 className="nbs-h2">Checklista <span className="nbs-count">{ ( v.checked || [] ).length }/{ tpl.checklist.length }</span></h2>
					<div className="nbs-checklist-grid">
						{ tpl.checklist.map( ( c, i ) => {
							const on = ( v.checked || [] ).includes( i );
							return (
								<label key={ i } className={ `nbs-check-item${ on ? ' is-on' : '' }` }>
									<input type="checkbox" checked={ on } disabled={ done } onChange={ () => toggleCheck( i ) } />
									<span>{ c }</span>
								</label>
							);
						} ) }
					</div>
				</section>
			) }

			<section className="nbs-card">
				<h2 className="nbs-h2">Kupkontroll</h2>
				{ colonies.length === 0 && <p className="nbs-muted">Inga aktiva samhällen i bigården.</p> }
				{ colonies.length > 3 && (
					<nav className="nbs-colony-jump" aria-label="Hoppa till samhälle">
						{ colonies.map( ( c ) => (
							<a key={ c.id } href={ '#nbs-c-' + c.id } onClick={ ( e ) => ( e.preventDefault(), document.getElementById( 'nbs-c-' + c.id ).scrollIntoView( { behavior: 'smooth', block: 'start' } ) ) } className={ hasData( c ) ? 'is-done' : insp[ c.id ] && insp[ c.id ].skipped ? 'is-skipped' : '' }>{ c.code }</a>
						) ) }
					</nav>
				) }
				<div className="nbs-colonies">
					{ colonies.map( ( c ) => {
						const i = insp[ c.id ] || { data: {}, note: '', skipped: false };
						const q = reg.queen[ c.queen_id ];
						const hv = reg.hive[ c.hive_id ];
						return (
							<article key={ c.id } id={ 'nbs-c-' + c.id } className={ `nbs-colony-card${ hasData( c ) ? ' is-done' : '' }${ i.skipped ? ' is-skipped' : '' }` }>
								<header>
									<h3><a href={ href( 'samhallen/' + c.id ) }>Samhälle { c.code }</a></h3>
									<span className="nbs-muted">{ hv ? `Kupa ${ hv.label }` : '' }{ q && <> · <QueenBadge q={ q } link={ false } /></> }{ c.strength ? ` · styrka ${ c.strength }` : '' }</span>
									{ ! done && <label className="nbs-inline-check nbs-skip"><input type="checkbox" checked={ !! i.skipped } onChange={ ( e ) => setInsp( c.id, { skipped: e.target.checked } ) } /> Kontrolleras inte</label> }
								</header>
								{ ! i.skipped && (
									done ? (
										<p>{ tpl.fields.filter( ( f ) => i.data && i.data[ f.key ] !== undefined ).map( ( f ) => `${ f.label } ${ formatValue( f, i.data[ f.key ], reg.refs ) }` ).join( ' · ' ) || <span className="nbs-muted">Inget ifyllt</span> }{ i.note && <em> – { i.note }</em> }</p>
									) : (
										<div className="nbs-insp-grid">
											{ tpl.fields.map( ( f ) => (
												<FieldInput key={ f.key } field={ f } idPrefix={ `nbs-${ c.id.slice( 0, 8 ) }-` } tri value={ i.data ? i.data[ f.key ] : undefined } onChange={ ( val ) => setInsp( c.id, { data: { [ f.key ]: val } } ) } refs={ reg.refs } />
											) ) }
											<div className="nbs-field nbs-span-2">
												<label htmlFor={ 'nbs-note-' + c.id }>Anteckning</label>
												<input id={ 'nbs-note-' + c.id } type="text" value={ i.note || '' } onChange={ ( e ) => setInsp( c.id, { note: e.target.value } ) } />
											</div>
										</div>
									)
								) }
							</article>
						);
					} ) }
				</div>
			</section>

			{ ( v.material || [] ).length > 0 && (
				<section className="nbs-card">
					<h2 className="nbs-h2">Material från lagret</h2>
					<p className="nbs-muted">{ done ? 'Bokat i lagret när besöket avslutades.' : `Bokas när besöket avslutas. Per samhälle räknas på de ${ inspected.length } kontrollerade samhällena.` }</p>
					{ v.material.map( ( m, i ) => {
						const it = stock.item[ m.item_id ];
						const u = unit( it );
						return (
							<div key={ i } className={ `nbs-vmat${ m.skip ? ' is-skipped' : '' }` }>
								<label className="nbs-inline-check"><input type="checkbox" checked={ ! m.skip } disabled={ done } onChange={ ( e ) => setMat( i, { skip: ! e.target.checked } ) } /> <strong>{ m.label || ( it && it.name ) }</strong></label>
								{ ! m.skip && (
									<div className="nbs-vmat-fields">
										<input type="text" inputMode="decimal" value={ m.qty } disabled={ done } onChange={ ( e ) => setMat( i, { qty: e.target.value } ) } aria-label="Mängd" />
										<span>{ u } { PER[ m.per ] } { m.kind === 'move' ? '(till kupan)' : '' }</span>
										<select value={ m.from ? `${ m.from.type }:${ m.from.id }` : '' } disabled={ done } onChange={ ( e ) => {
											const [ type, fid ] = e.target.value.split( ':' );
											setMat( i, { from: { type, id: fid } } );
										} } aria-label="Från">
											{ fromOptions( m ).map( ( o ) => <option key={ o.type + o.id } value={ `${ o.type }:${ o.id }` }>från { o.name } ({ fmtQty( o.qty ) } { u })</option> ) }
										</select>
										{ m.per === 'colony' && <span className="nbs-muted">= { fmtQty( matTotal( m ) ) } { u }</span> }
									</div>
								) }
							</div>
						);
					} ) }
				</section>
			) }

			<section className="nbs-card">
				<h2 className="nbs-h2">Kontrollpunkter och avvikelser</h2>
				<fieldset className="nbs-radios nbs-result">
					<legend>Resultat</legend>
					<label><input type="radio" checked={ v.result === 'ok' } disabled={ done } onChange={ () => update( { result: 'ok' } ) } /> Godkänt</label>
					<label><input type="radio" checked={ v.result === 'action' } disabled={ done } onChange={ () => update( { result: 'action', followup: true } ) } /> Åtgärd krävs</label>
				</fieldset>
				<div className="nbs-field">
					<label htmlFor="nbs-v-dev">Avvikelse / åtgärd</label>
					<textarea id="nbs-v-dev" rows={ 2 } value={ v.deviation } disabled={ done } onChange={ ( e ) => update( { deviation: e.target.value } ) } />
				</div>
				<div className="nbs-form-row">
					<label className="nbs-inline-check"><input type="checkbox" checked={ v.followup } disabled={ done } onChange={ ( e ) => update( { followup: e.target.checked } ) } /> Uppföljning behövs</label>
					{ v.followup && (
						<div className="nbs-field">
							<label htmlFor="nbs-v-fu">Följ upp senast</label>
							<input id="nbs-v-fu" type="date" value={ v.followup_date || '' } disabled={ done } onChange={ ( e ) => update( { followup_date: e.target.value } ) } />
						</div>
					) }
				</div>
				{ done && v.followup && (
					<label className="nbs-inline-check"><input type="checkbox" checked={ v.followup_done } onChange={ ( e ) => api( 'visits/' + id, { method: 'PUT', body: { followup_done: e.target.checked } } ).then( setV ) } /> Uppföljningen är gjord</label>
				) }
				<div className="nbs-field">
					<label htmlFor="nbs-v-notes">Övriga noteringar</label>
					<textarea id="nbs-v-notes" rows={ 3 } value={ v.notes } disabled={ done } onChange={ ( e ) => update( { notes: e.target.value } ) } />
				</div>
			</section>

			{ me.can.write && (
				<div className="nbs-visit-foot">
					{ done ? (
						<>
							<span className="nbs-muted">Avslutat { v.done_at ? fmtDate( v.done_at ) : '' }{ v.user ? ` av ${ v.user }` : '' }.</span>
							<span className="nbs-spacer" />
							<Button variant="danger-link" onClick={ remove }>Ta bort</Button>
							<Button variant="ghost" onClick={ reopen }>Öppna igen</Button>
						</>
					) : (
						<>
							<Button variant="danger-link" onClick={ remove }>Ta bort</Button>
							<span className="nbs-spacer" />
							<Button onClick={ () => setConfirming( true ) } disabled={ busy }>Avsluta besöket</Button>
						</>
					) }
				</div>
			) }

			{ confirming && (
				<Modal
					title="Avsluta besöket"
					onClose={ () => setConfirming( false ) }
					footer={
						<>
							<span className="nbs-spacer" />
							<Button variant="ghost" onClick={ () => setConfirming( false ) }>Tillbaka</Button>
							<Button onClick={ complete } disabled={ busy }>{ busy ? 'Avslutar…' : 'Avsluta och spara' }</Button>
						</>
					}
				>
					<div className="nbs-form">
						<p><strong>{ inspected.length }</strong> av { colonies.length } samhällen har kupkontroll ifylld och får den i sin historik.{ inspected.length < colonies.length && ' Övriga samhällen räknas inte som kontrollerade.' }</p>
						{ ( v.material || [] ).filter( ( m ) => ! m.skip && matTotal( m ) > 0 ).length > 0 ? (
							<>
								<p>Detta bokas i lagret:</p>
								<ul className="nbs-contents">
									{ v.material.filter( ( m ) => ! m.skip && matTotal( m ) > 0 ).map( ( m, i ) => (
										<li key={ i }><strong>{ fmtQty( matTotal( m ) ) } { unit( stock.item[ m.item_id ] ) }</strong> { stock.item[ m.item_id ] ? stock.item[ m.item_id ].name : '' } { m.kind === 'move' ? '→ kuporna' : 'förbrukas' }</li>
									) ) }
								</ul>
							</>
						) : <p className="nbs-muted">Inget material bokas.</p> }
						{ tpl.fields.some( ( f ) => f.maps === 'strength' ) && <p className="nbs-muted">Samhällenas styrka uppdateras från kupkontrollen.</p> }
						{ ! v.result && <p className="nbs-warn">Resultat är inte valt (godkänt / åtgärd krävs).</p> }
					</div>
				</Modal>
			) }
		</div>
	);
}

/* ------------------------------------------------------------------ Utskrift */

/** Skötselkortet som A4, likt korten i driftplanen. Från ett besök fylls bigård, datum och samhällen i. */
function PrintCard( { templateId, visitId, templates } ) {
	const reg = useRegister();
	const [ visit ] = useLoad( () => ( visitId ? api( 'visits/' + visitId ) : Promise.resolve( null ) ), [ visitId ] );
	if ( visitId && ! visit ) {
		return <Loading />;
	}
	const tpl = visit ? visit.template : templates.find( ( t ) => t.id === templateId );
	if ( ! tpl ) {
		return <div className="nbs-page"><Empty title="Kortet finns inte" /></div>;
	}
	const ap = visit && reg.apiary[ visit.apiary_id ];
	const colonies = ap ? reg.coloniesIn( ap.id ).slice().sort( byCode ) : [];
	const rows = colonies.length ? colonies : Array.from( { length: 12 }, () => null );
	const half = Math.ceil( tpl.checklist.length / 2 );
	const back = visitId ? 'besok/' + visitId : 'besok/kort/' + tpl.id;
	return (
		<div className="nbs-page nbs-print-page">
			<div className="nbs-print-tools">
				<a className="nbs-back" href={ href( back ) }>← Tillbaka</a>
				<Button onClick={ () => window.print() }>Skriv ut</Button>
			</div>
			<article className="nbs-sheet">
				<header className="nbs-sheet-head">
					<h1>{ tpl.name }</h1>
					<p>Arbetsinstruktion • Checklista • Dokumentation</p>
				</header>
				<table className="nbs-sheet-meta">
					<tbody>
						<tr><th>Datum</th><td>{ visit ? visit.date : '' }</td><th>Antal samhällen</th><td>{ colonies.length || '' }</td><th>Ansvarig</th><td>{ visit ? visit.user : '' }</td></tr>
						<tr><th>Bigård</th><td>{ ap ? ap.name : '' }</td><th>Starttid</th><td>{ visit ? visit.start_time : '' }</td><th>Sluttid</th><td>{ visit ? visit.end_time : '' }</td></tr>
					</tbody>
				</table>
				<h2>1. Syfte och resultat</h2>
				<p>{ tpl.purpose }</p>
				<h2>2. Förberedelser och material</h2>
				<ul className="nbs-sheet-boxes nbs-two-col">
					{ tpl.material.map( ( m, i ) => <li key={ i }>{ m.label }{ m.item_id && m.qty ? ` (${ fmtQty( m.qty ) } ${ PER[ m.per ] })` : '' }</li> ) }
				</ul>
				<h2>3. Rutinbeskrivning</h2>
				{ tpl.steps.map( ( s, i ) => (
					<div key={ i } className="nbs-sheet-step"><h3>{ String.fromCharCode( 65 + i ) }. { s.title }</h3><p>{ s.text }</p></div>
				) ) }
				<h2>4. Checklista – utförande</h2>
				<div className="nbs-two-col">
					{ [ tpl.checklist.slice( 0, half ), tpl.checklist.slice( half ) ].map( ( col, k ) => (
						<ol key={ k } start={ k * half + 1 } className="nbs-sheet-boxes">{ col.map( ( c, i ) => <li key={ i }>{ c }</li> ) }</ol>
					) ) }
				</div>
				<h2>5. Kontrollpunkter och avvikelser</h2>
				<p className="nbs-sheet-boxes-inline">□ Godkänt &nbsp;&nbsp; □ Åtgärd krävs &nbsp;&nbsp; Avvikelse / åtgärd: ____________________________________________</p>
				<h2>6. Kupkontroll</h2>
				<table className="nbs-sheet-table">
					<thead><tr><th>Nr</th>{ tpl.fields.map( ( f ) => <th key={ f.key }>{ f.label }{ f.type === 'scale' ? ` (${ f.min ?? 1 }–${ f.max ?? 5 })` : f.unit ? ` (${ f.unit })` : '' }</th> ) }<th>Anteckning</th></tr></thead>
					<tbody>
						{ rows.map( ( c, i ) => (
							<tr key={ i }>
								<td>{ c ? c.code : '' }</td>
								{ tpl.fields.map( ( f ) => <td key={ f.key }>{ f.type === 'bool' ? '□ Ja  □ Nej' : '' }</td> ) }
								<td></td>
							</tr>
						) ) }
					</tbody>
				</table>
				<h2>7. Övriga noteringar</h2>
				<div className="nbs-sheet-lines" />
				<p className="nbs-sheet-foot">Uppföljning □ Ja / □ Nej &nbsp;&nbsp;&nbsp; Signatur ______________________</p>
			</article>
		</div>
	);
}

/**
 * Skötselkortet som en behandling: varje samhälle som kontrolleras i besöket får behandlingen
 * registrerad i Bihälsa (syns på samhället, i bihälsologgen och i varroamodellen).
 */
function CardTreatment( { form, set, treatList, stock } ) {
	const list = form.treatment;
	const items = ( treatList || [] ).filter( ( x ) => x.active !== false );
	const upd = ( i, patch ) => set( 'treatment', list.map( ( t, j ) => ( j === i ? { ...t, ...patch } : t ) ) );
	return (
		<section className="nbs-card">
			<h2 className="nbs-h2">Behandlingar</h2>
			<p className="nbs-muted">Behandlingar som alltid görs med kortet registreras på varje samhälle som kontrolleras när besöket avslutas. De syns på samhället, under Bihälsa och i varroamodellen – och i modellen redan när kortet ligger i driftplanen. Behandlingar som bara görs ibland kopplas i stället till ett ja/nej-fält i kupkontrollen.</p>
			{ list.map( ( t, i ) => {
				const d = ( items.find( ( x ) => x.id === t.id ) || {} ).data || {};
				const mat = d.material && stock && stock.item[ d.material ];
				const hasMat = d.material && form.material.some( ( m ) => m.item_id === d.material );
				return (
					<div key={ t._id } className="nbs-card-treat">
						<div className="nbs-form-row">
							<div className="nbs-field">
								<label htmlFor={ 'nbs-t-treat-' + i }>Behandlingsmedel</label>
								<select id={ 'nbs-t-treat-' + i } value={ t.id || '' } onChange={ ( e ) => upd( i, { id: e.target.value, kill: '' } ) }>
									<option value="">Välj…</option>
									{ items.map( ( x ) => <option key={ x.id } value={ x.id }>{ x.name }</option> ) }
								</select>
							</div>
							<div className="nbs-field">
								<label htmlFor={ 'nbs-t-kill-' + i }>Förväntad avdödning</label>
								<div className="nbs-inline">
									<input id={ 'nbs-t-kill-' + i } type="number" min="0" max="100" value={ t.kill ?? '' } placeholder={ d.avdodning !== undefined && d.avdodning !== null && d.avdodning !== '' ? String( d.avdodning ) : '' } onChange={ ( e ) => upd( i, { kill: e.target.value } ) } /> %
									<button type="button" className="nbs-link-btn" onClick={ () => set( 'treatment', list.filter( ( _, j ) => j !== i ) ) }>Ta bort</button>
								</div>
							</div>
						</div>
						{ d.foretisk && <label className="nbs-check"><input type="checkbox" checked={ !! t.broodless } onChange={ ( e ) => upd( i, { broodless: e.target.checked } ) } /> Samhället är yngelfritt vid behandlingen (full verkan, t.ex. oxalsyra i det nya Samuelsamhället)</label> }
						{ mat && ! hasMat && (
							<p className="nbs-muted">Förbrukar <strong>{ mat.name }</strong> från lagret. <button type="button" className="nbs-link-btn" onClick={ () => set( 'material', [ ...form.material, { _id: uuid(), item_id: d.material, label: mat.name, qty: 1, per: 'colony', kind: 'consume' } ] ) }>Lägg till i materialet (1 per samhälle)</button></p>
						) }
					</div>
				);
			} ) }
			<Button small variant="ghost" onClick={ () => set( 'treatment', [ ...list, { _id: uuid(), id: '', kill: '', broodless: false } ] ) }>+ Behandling</Button>
		</section>
	);
}
