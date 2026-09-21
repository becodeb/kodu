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
  onGuardar: (datos: { title: string; description: string }) => void;
  onOmitir: () => void;
}

export default function FichaDialog(props: FichaDialogProps) {
  const [title, setTitle] = useState(
    props.tituloInicial === 'Nuevo Recurso' ? '' : props.tituloInicial,
  );
  const [description, setDescription] = useState('');

  const listo = title.trim().length > 0;

  return (
    <Modal
      abierto={props.abierto}
      titulo="¿Qué vas a armar?"
      descripcion="Dos datos para no perderlo después. Los podés cambiar cuando quieras desde el visor."
      onCerrar={props.onOmitir}
      pie={
        <>
          <button type="button" onClick={props.onOmitir} className="kodu-btn-ghost text-sm">
            Después
          </button>
          <button
            type="button"
            disabled={!listo}
            onClick={() => props.onGuardar({ title: title.trim(), description: description.trim() })}
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

      <p className="text-xs text-ink-500">
        Compartir el recurso con el resto de la escuela se hace después, desde el visor, cuando
        ya tenga algo para mostrar y una portada.
      </p>
    </Modal>
  );
}
