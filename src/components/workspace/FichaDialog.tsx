import { useState } from 'react';
import Modal from './Modal.tsx';

/**
 * Ficha inicial del recurso, al abrir uno nuevo.
 *
 * Se pregunta ACÁ y no después porque el título y la descripción son lo que
 * hace que un recurso se pueda encontrar, y pedirlos al final —cuando el
 * docente ya consiguió lo que quería— es garantizar que queden vacíos: la
 * galería termina llena de "Nuevo Recurso" sin descripción.
 *
 * La portada no se pregunta: todavía no hay nada que fotografiar.
 */

interface FichaDialogProps {
  abierto: boolean;
  tituloInicial: string;
  onGuardar: (datos: { title: string; description: string; isInGallery: boolean }) => void;
  onOmitir: () => void;
}

export default function FichaDialog(props: FichaDialogProps) {
  const [title, setTitle] = useState(
    props.tituloInicial === 'Nuevo Recurso' ? '' : props.tituloInicial,
  );
  const [description, setDescription] = useState('');
  const [isInGallery, setIsInGallery] = useState(false);

  const listo = title.trim().length > 0;

  return (
    <Modal
      abierto={props.abierto}
      titulo="¿Qué vas a armar?"
      descripcion="Dos datos para no perderlo después. Lo podés cambiar cuando quieras desde la pestaña Ficha."
      onCerrar={props.onOmitir}
      pie={
        <>
          <button type="button" onClick={props.onOmitir} className="kodu-btn-ghost text-sm">
            Después
          </button>
          <button
            type="button"
            disabled={!listo}
            onClick={() => props.onGuardar({ title: title.trim(), description: description.trim(), isInGallery })}
            className="kodu-btn-primary text-sm"
          >
            Guardar y empezar
          </button>
        </>
      }
    >
      <div>
        <label className="kodu-label" htmlFor="ficha-nueva-titulo">
          Título
        </label>
        <input
          id="ficha-nueva-titulo"
          className="kodu-input"
          value={title}
          maxLength={120}
          placeholder="Ej.: Quiz de fracciones equivalentes"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div>
        <label className="kodu-label" htmlFor="ficha-nueva-descripcion">
          Descripción
        </label>
        <textarea
          id="ficha-nueva-descripcion"
          className="kodu-input resize-none"
          rows={3}
          maxLength={400}
          value={description}
          placeholder="Qué enseña y para qué grado, en una o dos frases."
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-linea p-3">
        <input
          type="checkbox"
          checked={isInGallery}
          onChange={(event) => setIsInGallery(event.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
            isInGallery ? 'bg-brand-600' : 'bg-linea'
          }`}
        >
          <span
            className={`h-5 w-5 rounded-full bg-superficie shadow-sm transition-transform ${
              isInGallery ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </span>
        <span>
          <span className="block text-sm font-semibold text-ink-900">
            Publicar en la galería institucional
          </span>
          <span className="mt-0.5 block text-xs text-ink-500">
            Podés activarlo más tarde, cuando el recurso esté listo.
          </span>
        </span>
      </label>

      <p className="text-xs text-ink-500">
        La portada que se ve en la galería se saca después, desde la pestaña{' '}
        <strong className="font-semibold text-ink-700">Ficha</strong>, cuando el recurso ya tenga
        algo para mostrar.
      </p>
    </Modal>
  );
}
