import { useState } from '@wordpress/element';
import { api, uuid } from './api';
import { useLoad, ErrorBox, Button, Modal, useToast } from './ui';
import { FieldInput } from './fields';
import { useMe } from './App';
import { useRegister } from './register';
import { FieldsModal as RegFieldsModal } from './reg-ui';

/**
 * Gemensamt för registren i fas 4–8 (driftplan, bihälsa, honung, avel, ekonomi).
 * De sparas via /r/<typ> och har, precis som bigårdar och samhällen, egna fält.
 */

export const useRecords = ( type, query = {}, deps = [] ) => {
	const qs = new URLSearchParams( Object.fromEntries( Object.entries( query ).filter( ( [ , v ] ) => v !== '' && v !== null && v !== undefined ) ) ).toString();
	return useLoad( () => api( `r/${ type }${ qs ? '?' + qs : '' }` ), [ type, qs, ...deps ] );
};

export const saveRecord = ( type, body, id ) => ( id ? api( `r/${ type }/${ id }`, { method: 'PUT', body } ) : api( `r/${ type }`, { method: 'POST', body: { id: uuid(), ...body } } ) );
export const deleteRecord = ( type, id ) => api( `r/${ type }/${ id }`, { method: 'DELETE' } );

/** Modulinställningar (fodermål, avelsvikter, tillväxtplan) och egna fält per register. */
export const useModules = () => useLoad( () => api( 'modules' ) );

export const thisYear = () => new Date().getFullYear();
const nf = new Intl.NumberFormat( 'sv-SE', { maximumFractionDigits: 1 } );
export const fmtNum = ( v ) => ( v === null || v === undefined || v === '' ? '–' : nf.format( v ) );
export const fmtKr = ( v ) => new Intl.NumberFormat( 'sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 } ).format( v || 0 );

export function YearSelect( { value, onChange, from = 2024 } ) {
	const years = [];
	for ( let y = thisYear() + 2; y >= from; y-- ) {
		years.push( y );
	}
	return (
		<select value={ value } onChange={ ( e ) => onChange( Number( e.target.value ) ) } aria-label="År">
			{ years.map( ( y ) => <option key={ y } value={ y }>{ y }</option> ) }
		</select>
	);
}

/**
 * Formulär för en post. fields = fasta fält i FieldInput-format; egna fält för typen
 * läggs till under. Fält med `when` visas bara när villkoret gäller.
 */
export function RecordForm( { type, title, fields, item = {}, preset = {}, custom = [], onClose, onSaved, wide } ) {
	const reg = useRegister();
	const me = useMe();
	const toast = useToast();
	const isNew = ! item.id;
	const [ form, setForm ] = useState( () => ( { ...preset, ...item, data: { ...( item.data || {} ) } } ) );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	const set = ( k, v ) => setForm( ( f ) => ( { ...f, [ k ]: v } ) );
	const shown = fields.filter( ( f ) => ! f.when || f.when( form ) );

	const save = async ( e ) => {
		e && e.preventDefault();
		setBusy( true );
		setErr( null );
		const body = { data: form.data };
		fields.forEach( ( f ) => ( body[ f.key ] = form[ f.key ] ?? null ) );
		Object.keys( preset ).forEach( ( k ) => ( body[ k ] = form[ k ] ) );
		try {
			const saved = await saveRecord( type, body, item.id );
			toast( isNew ? 'Sparat.' : 'Ändringen sparades.' );
			onSaved && onSaved( saved );
			onClose();
		} catch ( e2 ) {
			setErr( e2 );
			setBusy( false );
		}
	};
	const remove = async () => {
		if ( ! window.confirm( 'Ta bort posten? Det går inte att ångra.' ) ) {
			return;
		}
		try {
			await deleteRecord( type, item.id );
			toast( 'Posten togs bort.' );
			onSaved && onSaved( null );
			onClose();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	return (
		<Modal
			wide={ wide }
			title={ title }
			onClose={ onClose }
			footer={
				<>
					{ ! isNew && me.can.write && <Button variant="danger-link" onClick={ remove }>Ta bort</Button> }
					<span className="nbs-spacer" />
					<Button variant="ghost" onClick={ onClose }>Avbryt</Button>
					<Button onClick={ save } disabled={ busy }>{ busy ? 'Sparar…' : 'Spara' }</Button>
				</>
			}
		>
			<form onSubmit={ save } className="nbs-form">
				<ErrorBox error={ err } />
				<div className="nbs-form-grid">
					{ shown.map( ( f ) => (
						<div key={ f.key } className={ f.type === 'textarea' || f.wide ? 'nbs-span-2' : '' }>
							{ f.render ? f.render( form, set ) : <FieldInput field={ f } value={ form[ f.key ] } onChange={ ( v ) => set( f.key, v ) } refs={ reg.refs } /> }
						</div>
					) ) }
					{ custom.map( ( f ) => (
						<div key={ 'x' + f.key } className={ f.type === 'textarea' ? 'nbs-span-2' : '' }>
							<FieldInput field={ f } value={ form.data[ f.key ] } onChange={ ( v ) => setForm( ( x ) => ( { ...x, data: { ...x.data, [ f.key ]: v } } ) ) } refs={ reg.refs } />
						</div>
					) ) }
				</div>
				<button type="submit" hidden />
			</form>
		</Modal>
	);
}

/** Egna fält för de nya registren (samma dialog som för bigårdar och samhällen). */
export function RecordFieldsModal( { type, fields, onClose, onSaved } ) {
	return <RegFieldsModal type={ type } initial={ fields } onClose={ onClose } onSaved={ onSaved } />;
}

/** Enkel tabell med klickbara rader. cols = [[rubrik, (rad) => innehåll, klass]]. */
export function Table( { rows, cols, onOpen, empty = 'Inga poster.' } ) {
	if ( ! rows.length ) {
		return <p className="nbs-muted">{ empty }</p>;
	}
	return (
		<div className="nbs-table-wrap">
			<table className="nbs-table">
				<thead><tr>{ cols.map( ( c ) => <th key={ c[ 0 ] } className={ c[ 2 ] || '' }>{ c[ 0 ] }</th> ) }</tr></thead>
				<tbody>
					{ rows.map( ( r ) => (
						<tr key={ r.id } className={ onOpen ? 'is-clickable' : '' } onClick={ onOpen ? ( e ) => ! e.target.closest( 'a, button, input, select' ) && onOpen( r ) : undefined }>
							{ cols.map( ( c, i ) => <td key={ c[ 0 ] } data-label={ i ? c[ 0 ] : undefined } className={ c[ 2 ] || '' }>{ c[ 1 ]( r ) }</td> ) }
						</tr>
					) ) }
				</tbody>
			</table>
		</div>
	);
}

/** Flikar under rubriken. tabs = [[nyckel, etikett, href]]. */
export function SubTabs( { tabs, current, label } ) {
	return (
		<nav className="nbs-subtabs" aria-label={ label }>
			{ tabs.map( ( [ k, l, h ] ) => <a key={ k } href={ h } className={ current === k ? 'is-active' : '' }>{ l }</a> ) }
		</nav>
	);
}

export function Stat( { label, value, sub } ) {
	return (
		<div className="nbs-stat">
			<strong>{ value }</strong>
			<span>{ label }</span>
			{ sub && <small className="nbs-muted">{ sub }</small> }
		</div>
	);
}
