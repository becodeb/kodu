/** Recursos editoriales de Kodu, disponibles también sin sembrar la base. */
export const CELULA_EJEMPLO_ID = 'kodu-ejemplo-celula';
export const ejemplos = [
  { id: CELULA_EJEMPLO_ID, titulo: 'La célula animal', area: 'Ciencias naturales · 7.º grado', descripcion: 'Girá la célula en 3D, explorá sus organelos y compará cómo trabajan juntos.', url: '/p/kodu-ejemplo-celula', imagen: '/demos/assets/celula-preview.webp', alt: 'Modelo 3D de una célula animal con organelos seleccionables' },
  { id: 'funciones', titulo: 'Funciones que podés explorar', area: 'Matemática · Secundaria', descripcion: 'Mové los coeficientes, anticipá cambios y poné a prueba tus hipótesis.', url: '/demos/explorador-funciones.html', imagen: '/demos/assets/funciones-preview.webp', alt: 'Graficador de funciones con controles para sus coeficientes' },
  { id: 'fisica', titulo: 'Un mismo tiro, otro planeta', area: 'Física · Secundaria', descripcion: 'Compará trayectorias en la Tierra y la Luna. ¿Qué cambia con la gravedad?', url: '/demos/tiro-oblicuo.html', imagen: '/demos/assets/fisica-preview.webp', alt: 'Simulador de tiro oblicuo con ángulo, velocidad y gravedad regulables' },
] as const;
