# Acceso remoto a SICOVEN sin sincronización

## Modalidad admitida

SICOVEN se instala y ejecuta únicamente en la PC anfitriona (PC A). La base SQLite de cada empresa permanece en el disco local de esa PC. La PC B se conecta mediante una herramienta de escritorio remoto segura y controla la sesión de SICOVEN que está abierta en PC A.

No se copia ni se abre el archivo SQLite desde PC B. No se publica SQLite en una carpeta compartida, no se abre un puerto de base de datos y no se requiere un servidor de datos.

## Flujo

1. Instalar SICOVEN en PC A y mantener las bases SQLite dentro del directorio local de datos de SICOVEN.
2. Configurar acceso remoto seguro a PC A mediante escritorio remoto, preferiblemente protegido por una VPN privada o red de confianza.
3. Configurar una cuenta individual en la herramienta de acceso remoto y mantener activa la misma sesión de Windows que contiene los datos locales de SICOVEN.
4. Desde PC B, conectarse a la sesión de escritorio existente de PC A. El contador se autentica dentro de SICOVEN con su propio usuario y permisos; no necesita la contraseña del administrador de Windows ni de SICOVEN.
5. Al terminar, desconectarse de forma segura y dejar que SICOVEN confirme la persistencia local.

## Requisitos operativos

- PC A debe estar encendida, conectada y sin suspensión automática durante el acceso.
- La conexión remota debe utilizar cifrado, autenticación fuerte y dispositivos autorizados.
- No exponer RDP directamente a Internet ni abrir el puerto 3389 al público; utilizar una VPN o solución remota segura.
- Mantener copias de seguridad locales y probar su restauración periódicamente.
- La conexión debe compartir la sesión de Windows que es propietaria del directorio local de datos de SICOVEN. Si se inicia sesión remota con otro usuario de Windows, ese perfil puede crear otra carpeta userData y otra SQLite distinta; no debe usarse como si compartiera los datos de PC A.
- Preferir una herramienta que controle la sesión existente en lugar de iniciar una sesión de Windows independiente.
- No permitir que dos procesos de SICOVEN abran el mismo archivo de datos mediante una carpeta de red.
- Mantener el bloqueo de instancia única y la persistencia SQLite actuales.

## Límite de concurrencia

Esta modalidad comparte una sesión de escritorio, no una base de datos multiusuario distribuida. El contador remoto controla la misma sesión de PC A; no obtiene una segunda copia independiente ni puede trabajar en paralelo en otra sesión contable separada. Si otro usuario está utilizando esa misma sesión, deben turnarse.

## Privacidad y disponibilidad

Los datos contables permanecen en el perfil local de PC A. PC B solo visualiza y controla la pantalla y teclado/mouse de esa sesión; el contador usa su propia cuenta dentro de SICOVEN. Si PC A se apaga, pierde Internet o la herramienta remota deja de estar disponible, el acceso remoto se interrumpe; los datos locales no se trasladan ni se sincronizan a PC B.

## Qué no debe hacerse

- No enviar por correo o mensajería el archivo SQLite para que ambos contadores lo abran.
- No colocar el archivo SQLite en OneDrive, Dropbox, Google Drive, NAS o una carpeta SMB para que dos instalaciones lo modifiquen.
- No habilitar una API pública para leer o escribir directamente la base.
- No confundir acceso remoto a la pantalla con sincronización o trabajo multiusuario simultáneo.
