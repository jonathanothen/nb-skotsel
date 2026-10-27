import { useState, useMemo } from '@wordpress/element';
import { api, uuid } from '../api';
import { href, go } from '../router';
import { useLoad, Loading, ErrorBox, Button, Modal, Empty, useToast } from '../ui';
import { FieldInput, formatValue, typeLabel } from '../fields';
import FieldDefs, { withIds, cleanFields } from '../FieldDefs';
import { useMe } from '../App';

/* ------------------------------------------------------------------ Listöversikt */

export default function Lists( { listId } ) {
	const me = useMe();
	const [ lists, error, reload, setLists ] = useLoad( () => api( 'lists' ) );
	const [ creating, setCreating ] = useState( false );

	if ( error ) {
		return <div className="nbs-page"><ErrorBox error={ error } /></div>;
	}
	if ( ! lists ) {
		return <Loading />;
	}
	const system = lists.filter( ( l ) => l.kind === 'system' && ! l.archived );
	const custom = lists.filter( ( l ) => l.kind !== 'system' && ! l.archived );
	const archived = lists.filter( ( l ) => l.archived );
	const updateCount = ( id, count ) => setLists( ( ls ) => ls.map( ( l ) => ( l.id === id ? { ...l, count } : l ) ) );

	const group = ( title, arr ) =>
		arr.length > 0 && (
			<div className="nbs-side-group">
				<h3>{ title }</h3>
				<ul>
					{ arr.map( ( l ) => (
						<li key={ l.id }>
							<a href={ href( 'listor/' + l.id ) } className={ l.id === listId ? 'is-active' : '' }>
								<span>{ l.name }</span>
								<span className="nbs-count">{ l.count }</span>
							</a>
						</li>
					) ) }
				</ul>
			</div>
		);

	return (
		<div className={ `nbs-split${ listId ? ' has-detail' : '' }` }>
			<aside className="nbs-side">
				<div className="nbs-side-head">
					<h1 className="nbs-h1">Listor</h1>
					{ me.can.write && <Button small onClick={ () => setCreating( true ) }>+ Ny lista</Button> }
				</div>
				<p className="nbs-muted">Dina egna variabler. Lägg till poster och egna fält – fält kan kopplas till andra listor.</p>
				{ group( 'Grundlistor', system ) }
				{ group( 'Egna listor', custom ) }
				{ group( 'Arkiverade', archived ) }
			</aside>
			<section className="nbs-detail">
				{ listId ? (
					<ListDetail key={ listId } listId={ listId } lists={ lists } onCount={ updateCount } onListChange={ reload } />
				) : (
					<Empty title="Välj en lista">
						<p>Välj en lista till vänster, eller skapa en egen lista med de fält du behöver.</p>
					</Empty>
				) }
			</section>
			{ creating && (
				<ListEditor
					lists={ lists }
					onClose={ () => setCreating( false ) }
					onSaved={ ( l ) => {
						setCreating( false );
						reload();
						go( 'listor/' + l.id );
					} }
				/>
			) }
		</div>
	);
}

/* ------------------------------------------------------------------ En lista */

function ListDetail( { listId, lists, onCount, onListChange } ) {
	const me = useMe();
	const toast = useToast();
	const [ data, error, , setData ] = useLoad( () => Promise.all( [ api( 'lists/' + listId ), api( 'refs' ) ] ), [ listId ] );
	const [ q, setQ ] = useState( '' );
	const [ showInactive, setShowInactive ] = useState( false );
	const [ editing, setEditing ] = useState( null );
	const [ editList, setEditList ] = useState( false );

	const items = data ? data[ 0 ].items : [];
	const visible = useMemo( () => {
		const s = q.trim().toLowerCase();
		return items.filter( ( i ) => ( showInactive || i.active ) && ( ! s || ( i.name + ' ' + i.code ).toLowerCase().includes( s ) ) );
	}, [ items, q, showInactive ] );

	if ( error ) {
		return <ErrorBox error={ error } />;
	}
	if ( ! data ) {
		return <Loading />;
	}
	const [ { list }, refs ] = data;
	const cols = list.fields.slice( 0, 4 );
	const inactive = items.filter( ( i ) => ! i.active ).length;

	const setItems = ( fn ) =>
		setData( ( d ) => {
			const next = fn( d[ 0 ].items );
			onCount( listId, next.length );
			return [ { ...d[ 0 ], items: next }, d[ 1 ] ];
		} );

	const move = async ( index, dir ) => {
		const arr = [ ...items ];
		const j = index + dir;
		if ( j < 0 || j >= arr.length ) {
			return;
		}
		[ arr[ index ], arr[ j ] ] = [ arr[ j ], arr[ index ] ];
		setItems( () => arr );
		try {
			await api( `lists/${ listId }/reorder`, { method: 'POST', body: { ids: arr.map( ( i ) => i.id ) } } );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};

	return (
		<div className="nbs-page">
			<a className="nbs-back" href={ href( 'listor' ) }>← Alla listor</a>
			<header className="nbs-page-head">
				<div>
					<p className="nbs-eyebrow">{ list.kind === 'system' ? 'Grundlista' : 'Egen lista' }{ list.archived ? ' · arkiverad' : '' }</p>
					<h1 className="nbs-h1">{ list.name }</h1>
					{ list.description && <p className="nbs-muted">{ list.description }</p> }
				</div>
				<div className="nbs-row-actions">
					{ me.can.write && <Button variant="ghost" onClick={ () => setEditList( true ) }>Redigera lista och fält</Button> }
					{ me.can.write && <Button onClick={ () => setEditing( {} ) }>+ Ny post</Button> }
				</div>
			</header>

			{ list.fields.length > 0 && (
				<p className="nbs-fields-line">
					Fält: { list.fields.map( ( f ) => <span key={ f.key } className="nbs-tag">{ f.label } <em>{ typeLabel( f.type ) }</em></span> ) }
				</p>
			) }

			<div className="nbs-toolbar">
				<input type="search" className="nbs-search" placeholder={ `Sök i ${ list.name.toLowerCase() }` } value={ q } onChange={ ( e ) => setQ( e.target.value ) } aria-label="Sök" />
				{ inactive > 0 && (
					<label className="nbs-inline-check">
						<input type="checkbox" checked={ showInactive } onChange={ ( e ) => setShowInactive( e.target.checked ) } /> Visa inaktiva ({ inactive })
					</label>
				) }
			</div>

			{ items.length === 0 ? (
				<Empty title="Listan är tom">
					<p>Lägg till den första posten.{ list.fields.length === 0 && ' Behöver posterna fler uppgifter än namn? Lägg till fält under "Redigera lista och fält".' }</p>
					{ me.can.write && <Button onClick={ () => setEditing( {} ) }>+ Ny post</Button> }
				</Empty>
			) : (
				<div className="nbs-table-wrap">
					<table className="nbs-table">
						<thead>
							<tr>
								<th>Namn</th>
								{ cols.map( ( f ) => <th key={ f.key }>{ f.label }</th> ) }
								{ me.can.write && <th className="nbs-col-order"><span className="screen-reader-text">Ordning</span></th> }
							</tr>
						</thead>
						<tbody>
							{ visible.map( ( it ) => {
								const index = items.indexOf( it );
								return (
									<tr key={ it.id } className={ it.active ? '' : 'is-inactive' }>
										<td>
											<button type="button" className="nbs-link-btn" onClick={ () => setEditing( it ) }>
												{ it.color && <span className="nbs-swatch" style={ { background: it.color } } /> }
												{ it.name }
											</button>
											{ it.code && <span className="nbs-code">{ it.code }</span> }
											{ ! it.active && <span className="nbs-badge">Inaktiv</span> }
										</td>
										{ cols.map( ( f ) => <td key={ f.key } data-label={ f.label }>{ formatValue( f, it.data[ f.key ], refs ) }</td> ) }
										{ me.can.write && (
											<td className="nbs-col-order">
												{ ! q && (
													<>
														<button type="button" className="nbs-icon-btn" onClick={ () => move( index, -1 ) } disabled={ index === 0 } aria-label="Flytta upp">↑</button>
														<button type="button" className="nbs-icon-btn" onClick={ () => move( index, 1 ) } disabled={ index === items.length - 1 } aria-label="Flytta ned">↓</button>
													</>
												) }
											</td>
										) }
									</tr>
								);
							} ) }
						</tbody>
					</table>
				</div>
			) }

			{ editing && (
				<ItemModal
					list={ list }
					refs={ refs }
					item={ editing }
					onClose={ () => setEditing( null ) }
					onSaved={ ( saved, isNew ) => {
						setItems( ( arr ) => ( isNew ? [ ...arr, saved ] : arr.map( ( i ) => ( i.id === saved.id ? saved : i ) ) ) );
						setEditing( null );
						toast( isNew ? 'Posten lades till.' : 'Ändringen sparades.' );
					} }
					onDeleted={ ( id ) => {
						setItems( ( arr ) => arr.filter( ( i ) => i.id !== id ) );
						setEditing( null );
						toast( 'Posten togs bort.' );
					} }
				/>
			) }
			{ editList && (
				<ListEditor
					list={ list }
					lists={ lists }
					onClose={ () => setEditList( false ) }
					onSaved={ ( l ) => {
						setData( ( d ) => [ { ...d[ 0 ], list: l }, d[ 1 ] ] );
						setEditList( false );
						onListChange();
						toast( 'Listan sparades.' );
					} }
					onDeleted={ () => {
						setEditList( false );
						onListChange();
						go( 'listor' );
						toast( 'Listan togs bort.' );
					} }
				/>
			) }
		</div>
	);
}

/* ------------------------------------------------------------------ Post */

function ItemModal( { list, refs, item, onClose, onSaved, onDeleted } ) {
	const toast = useToast();
	const isNew = ! item.id;
	const [ form, setForm ] = useState( {
		name: item.name || '',
		code: item.code || '',
		color: item.color || '',
		active: item.id ? item.active : true,
		data: { ...( item.data || {} ) },
	} );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	const set = ( k, v ) => setForm( ( f ) => ( { ...f, [ k ]: v } ) );
	const setVal = ( k, v ) => setForm( ( f ) => ( { ...f, data: { ...f.data, [ k ]: v } } ) );

	const save = async ( e ) => {
		e && e.preventDefault();
		setBusy( true );
		setErr( null );
		try {
			const body = { ...form, color: form.color || null };
			const saved = isNew
				? await api( `lists/${ list.id }/items`, { method: 'POST', body: { ...body, id: uuid() } } )
				: await api( `lists/${ list.id }/items/${ item.id }`, { method: 'PUT', body } );
			onSaved( saved, isNew );
		} catch ( e2 ) {
			setErr( e2 );
			setBusy( false );
		}
	};
	const remove = async () => {
		if ( ! window.confirm( `Ta bort "${ item.name }"? Det går inte att ångra. Vill du bara dölja posten kan du göra den inaktiv i stället.` ) ) {
			return;
		}
		try {
			await api( `lists/${ list.id }/items/${ item.id }`, { method: 'DELETE' } );
			onDeleted( item.id );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};

	return (
		<Modal
			title={ isNew ? `Ny post i ${ list.name.toLowerCase() }` : item.name }
			onClose={ onClose }
			footer={
				<>
					{ ! isNew && <Button variant="danger-link" onClick={ remove }>Ta bort</Button> }
					<span className="nbs-spacer" />
					<Button variant="ghost" onClick={ onClose }>Avbryt</Button>
					<Button onClick={ save } disabled={ busy }>{ busy ? 'Sparar…' : 'Spara' }</Button>
				</>
			}
		>
			<form onSubmit={ save } className="nbs-form">
				<ErrorBox error={ err } />
				<div className="nbs-field">
					<label htmlFor="nbs-name">Namn <span className="nbs-req">*</span></label>
					<input id="nbs-name" type="text" value={ form.name } onChange={ ( e ) => set( 'name', e.target.value ) } required />
				</div>
				<div className="nbs-form-row">
					<div className="nbs-field">
						<label htmlFor="nbs-code">Kod/förkortning</label>
						<input id="nbs-code" type="text" value={ form.code } onChange={ ( e ) => set( 'code', e.target.value ) } />
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-color">Färg</label>
						<div className="nbs-color-row">
							<input id="nbs-color" type="color" value={ form.color || '#D99A2B' } onChange={ ( e ) => set( 'color', e.target.value ) } />
							{ form.color ? <button type="button" className="nbs-link-btn" onClick={ () => set( 'color', '' ) }>Ingen färg</button> : <span className="nbs-muted">Ingen vald</span> }
						</div>
					</div>
				</div>
				{ list.fields.map( ( f ) => (
					<FieldInput key={ f.key } field={ f } value={ form.data[ f.key ] } onChange={ ( v ) => setVal( f.key, v ) } refs={ refs } />
				) ) }
				<label className="nbs-inline-check">
					<input type="checkbox" checked={ form.active } onChange={ ( e ) => set( 'active', e.target.checked ) } /> Aktiv (inaktiva poster går inte att välja i nya registreringar)
				</label>
				<button type="submit" hidden />
			</form>
		</Modal>
	);
}

/* ------------------------------------------------------------------ Lista och fält */

function ListEditor( { list, lists, onClose, onSaved, onDeleted } ) {
	const me = useMe();
	const toast = useToast();
	const isNew = ! list;
	const [ name, setName ] = useState( list ? list.name : '' );
	const [ description, setDescription ] = useState( list ? list.description : '' );
	const [ fields, setFields ] = useState( () => withIds( list ? list.fields : [] ) );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );

	const save = async () => {
		setBusy( true );
		setErr( null );
		const body = {
			name,
			description,
			fields: cleanFields( fields ),
		};
		try {
			const saved = isNew ? await api( 'lists', { method: 'POST', body: { ...body, id: uuid() } } ) : await api( 'lists/' + list.id, { method: 'PUT', body } );
			onSaved( saved );
		} catch ( e ) {
			setErr( e );
			setBusy( false );
		}
	};
	const archive = async () => {
		try {
			const saved = await api( 'lists/' + list.id, { method: 'PUT', body: { archived: ! list.archived } } );
			onSaved( saved );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	const remove = async () => {
		if ( ! window.confirm( `Ta bort listan "${ list.name }" och alla dess ${ list.count || 0 } poster? Det går inte att ångra.` ) ) {
			return;
		}
		try {
			await api( 'lists/' + list.id, { method: 'DELETE' } );
			onDeleted();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};

	const refLists = lists.filter( ( l ) => ! list || l.id !== list.id );

	return (
		<Modal
			wide
			title={ isNew ? 'Ny lista' : 'Redigera lista och fält' }
			onClose={ onClose }
			footer={
				<>
					{ ! isNew && list.kind !== 'system' && me.can.manage && <Button variant="danger-link" onClick={ remove }>Ta bort listan</Button> }
					{ ! isNew && <Button variant="link" onClick={ archive }>{ list.archived ? 'Återställ från arkiv' : 'Arkivera' }</Button> }
					<span className="nbs-spacer" />
					<Button variant="ghost" onClick={ onClose }>Avbryt</Button>
					<Button onClick={ save } disabled={ busy || ! name.trim() }>{ busy ? 'Sparar…' : 'Spara' }</Button>
				</>
			}
		>
			<div className="nbs-form">
				<ErrorBox error={ err } />
				<div className="nbs-field">
					<label htmlFor="nbs-list-name">Namn på listan <span className="nbs-req">*</span></label>
					<input id="nbs-list-name" type="text" value={ name } onChange={ ( e ) => setName( e.target.value ) } placeholder="T.ex. Vaxleverantörer eller Sockerdeg-recept" />
				</div>
				<div className="nbs-field">
					<label htmlFor="nbs-list-desc">Beskrivning</label>
					<textarea id="nbs-list-desc" rows={ 2 } value={ description } onChange={ ( e ) => setDescription( e.target.value ) } />
				</div>

				<h3 className="nbs-h3">Fält</h3>
				<p className="nbs-muted">Alla poster har namn, kod, färg och aktiv/inaktiv. Lägg till de extra uppgifter som listan behöver. Typen "Koppling till annan lista" gör att en post pekar på en post i en annan lista, t.ex. ett material som hör till ett ramformat.</p>

				<FieldDefs fields={ fields } setFields={ setFields } refLists={ refLists } />
				{ ! isNew && fields.length < list.fields.length && <p className="nbs-warn">Värden i borttagna fält försvinner från posterna nästa gång de sparas.</p> }
			</div>
		</Modal>
	);
}
