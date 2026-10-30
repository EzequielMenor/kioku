# Entrega del calendario v1
Objetivo: publicar una cadena revisable sin fusionar. Destino: EzequielMenor/kioku; base main; rama principal feat/calendar.
Estrategia: feature-branch-chain. Fuente verificada: feature/calendar@0f23cd3.335 pruebas,tipo/build/diff-check verdes.

## Specs
S1. Autorización de publicación: el usuario respondió "vale" a "¿Subo la rama y abro el PR, sin fusionarlo todavía?".
S2. Formato confirmado: "Cadena sobre rama de funcionalidad". PR principal borrador y partes dependientes con diferencias acotadas; no fusionar ni forzar ramas.
S3. Restricción vigente: "no me escribas nunca mas en ingles porfa para nada". Títulos y descripciones en español; identificadores técnicos se conservan.
S4. Entrega v1 aceptada; mantener visibles los límites de JARV-21/22/23/24 y no declarar Chromium de áreas finalizado.

## Tasks
D1 | S1-S4 | padre | done | Destino y main verificados,rama limpia;sin plantilla/CI propios ni main protegido;ProjectOS como tracker.
D2 | S1,S2 | padre | done | feature/calendar subido a origin;335 pruebas,sin omisiones,tipo/build/diff-check exit0.
D3 | S1-S4 | padre | in_progress | PR principal borrador y7partes;publicar refs por commit,sin modificar/reordenar commits existentes ni fusionar.
D4 | S1-S4 | padre | pending | Releer topología/diffs/estado de controles y registrar enlaces en ProjectOS JARV-17.

## Log
L1. Usuario autorizó subir/abrir con "vale" y reafirmó "Cadena sobre rama de funcionalidad".
L2. La fuente contiene4170adiciones+17borrados,incluido prototipo aportado de1049líneas. Se hace una única división honesta por unidades existentes;las vistas y áreas mantienen pruebas/docs aunque superen400líneas orientativas. No hay política propia de tamaño en destino.
L3. Seguimiento aprobado en ProjectOS:JARV-17(épica),18/19/20 completadas,21/22/24 abiertas,23Todo. No inventar GitHubissues ni etiquetas/políticas de otro repositorio;usar etiqueta existente enhancement y referencias no autocerrantes.
L4. Rama de seguimiento nueva desde main con este documento;partes mediante referencias a commits ya verificados:65e1013(modelo),11b7013(núcleo),44fc189(API),48e6253(vistas),7d4df1b(privacidad/foco),498906a(áreas),0f23cd3(UIáreas/cierre). Cada parte apunta a la anterior;primera a feat/calendar. feature/calendar original se conserva publicado.
