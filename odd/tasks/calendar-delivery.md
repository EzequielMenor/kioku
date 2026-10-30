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
D3 | S1-S4 | padre | done | PR#2borrador y#3–9abiertos;8ramas publicadas,heads/bases/diffs releídos;sin duplicados,force ni merge.
D4 | S1-S4 | padre | done | Topología confirmada,8enlaces registrados enProjectOSJARV-17;GitGuardianfuente finalsuccess,sin workflows propios ni estados exigidos configurados;límites conservados.

## Log
L1. Usuario autorizó subir/abrir con "vale" y reafirmó "Cadena sobre rama de funcionalidad".
L2. La fuente contiene4170adiciones+17borrados,incluido prototipo aportado de1049líneas. Se hace una única división honesta por unidades existentes;las vistas y áreas mantienen pruebas/docs aunque superen400líneas orientativas. No hay política propia de tamaño en destino.
L3. Seguimiento aprobado en ProjectOS:JARV-17(épica),18/19/20 completadas,21/22/24 abiertas,23Todo. No inventar GitHubissues ni etiquetas/políticas de otro repositorio;usar etiqueta existente enhancement y referencias no autocerrantes.
L4. Rama de seguimiento nueva desde main con este documento;partes mediante referencias a commits ya verificados:65e1013(modelo),11b7013(núcleo),44fc189(API),48e6253(vistas),7d4df1b(privacidad/foco),498906a(áreas),0f23cd3(UIáreas/cierre). Cada parte apunta a la anterior;primera a feat/calendar. feature/calendar original se conserva publicado.
L5. Todas las ramas de revisión publicadas. Primer gh pr create falló por error internoGraphQL deGitHub;una consultaREST confirma ceroPRs de calendario,no resultado duplicado. Cambiar una única vez el publicador a REST conservando destino,heads,bases,borrador y etiqueta;si vuelve a fallar,detener y reconciliar,no repetircreaciones a ciegas.
L6. REST con --input falló al procesarJSON;petición local verificada válida(3745caracteres). Nueva lecturaREST confirma ceroPRs. Ayuda localdegh confirma parámetros -f/-F y body@archivo;última corrección acotada envía campos sin --input (también etiquetas/actualización). Si falla,parar con bloqueo concreto;sin más variantes ni bucles.
L7. Publicador con campos -f/-F terminó exit0. PRprincipal:https://github.com/EzequielMenor/kioku/pull/2 (borrador,feat/calendar→main). Partes:https://github.com/EzequielMenor/kioku/pull/3 (modelo),/pull/4(núcleo),/pull/5(API),/pull/6(vistas),/pull/7(privacidad/foco),/pull/8(áreas),/pull/9(UIáreas). Todosabiertos,merged=false,mergeable=true ybaseinmediata confirmados medianteREST. Sin marcadores pendientes en cuerpos;etiqueta enhancement existente.
L8. Enlacesregistrados enProjectOSJARV-17. GitGuardian delcandidatocompleto0f23cd3 completed/success;statuscombinedpending con0statuses,no se confunde con verificación fallida/CIaprobado.No workflows propios ni mainprotegido.335pruebas/tipos/build/diff-check localesverdes. No merge,despliegue ni cierre deJARV21–24 por publicar.
