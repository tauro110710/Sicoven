# SICOVEN — separación del módulo especializado de inflación y REME

**Decisión de producto:** el módulo de inflación y REME no forma parte del espacio de trabajo habitual del contador independiente que lleva una cartera de pequeños comercios.

## Experiencia estándar
- No mostrar la pestaña «Inflación y REME» en la navegación ordinaria.
- No abrir el módulo mediante una ruta interna de la interfaz estándar.
- Mantener intactos los libros, saldos, cierres, reportes y datos de las empresas.
- No ejecutar cálculos REME ni generar asientos de ajuste por inflación.

## Alcance especializado reservado
Las pantallas, servicios, controles de preparación, expedientes y documentación técnica existentes se conservan en el repositorio como componentes especializados, fuera de la navegación estándar. Su eventual habilitación deberá formar parte de una edición/perfil avanzado para despachos contables o entidades que realmente requieran ese trabajo, con permisos y pruebas propios.

## Límites
Esta separación de interfaz no declara terminado, validado ni habilitado el motor REME. Se mantiene el estado técnico existente: el cálculo operativo REME permanece deshabilitado. No se eliminan datos, tablas, expedientes, pruebas ni antecedentes normativos.
