// Traducción de cortesía al español de los textos legales. Prevalece la versión en portugués (legal-text.ts).
// BORRADOR: debe revisarla un abogado junto con el texto en portugués antes del lanzamiento (ver GOLIVE.md).
import { COMPANY, LEGAL_UPDATED_ES } from './legal-text-shared.ts';
import type { LegalDoc } from './legal-text-shared.ts';

const NOTICE = 'Traducción de cortesía. Si hay alguna diferencia, prevalece la versión en portugués.';

export function buildPrivacyEs(email: string): LegalDoc {
  return {
    title: 'Política de Privacidad',
    notice: NOTICE,
    updated: LEGAL_UPDATED_ES,
    intro:
      'AskouT ayuda a los amigos a organizar encuentros presenciales. Esta política explica qué datos personales tratamos, para qué, con quién los compartimos y cómo ejercer tus derechos, según la Ley General de Protección de Datos de Brasil (Ley 13.709/2018, la LGPD).',
    blocks: [
      {
        title: '1. Quién es el responsable',
        text: [
          `El responsable del tratamiento (controlador) es ${COMPANY.name}, CNPJ ${COMPANY.cnpj}, con sede en ${COMPANY.address}, empresa que opera AskouT.`,
          `Para cualquier asunto de privacidad, incluido contactar al encargado de datos (DPO), ${COMPANY.dpo}, escribe a ${email}.`,
        ],
      },
      {
        title: '2. Qué datos tratamos',
        items: [
          'Cuenta: correo electrónico, @usuario, nombre y contraseña (guardada de forma irreversible, nunca en texto abierto). Si entras con Google o Apple, recibimos su confirmación de identidad y el correo de la cuenta.',
          'Fecha de nacimiento: se pide al registrarte para comprobar la edad mínima (18 años). No se muestra a otras personas. Puedes corregirla en Editar perfil (quien figure como menor de 18 años debe hablar con soporte). También guardamos el día y la versión de los Términos que aceptaste al crear la cuenta.',
          'Perfil y contenido: foto de perfil, publicaciones, fotos, videos, eventos que publicas, comentarios, me gusta y mensajes de chats y grupos.',
          'Relaciones: a quién sigues, quién te sigue, a quién bloqueaste y las personas que apruebas en el perfil privado. Dos perfiles que se siguen mutuamente son "amigos" en AskouT.',
          'Agenda y planes: los días y horarios en que marcas que puedes salir, los modos "Flash" (disponibilidad temporal), encuestas de fecha y asistencia a eventos.',
          'Ubicación: solo cuando lo permites. En Explorar y en el mapa usamos la posición del dispositivo para encontrar lugares y eventos cercanos y no guardamos esa posición. En "Mi región" (opcional) guardamos una coordenada redondeada (cerca de 1 km) para anuncios por región. Puedes borrarla en cualquier momento.',
          'Uso para recomendaciones: cuánto tiempo pasas en cada contenido y si abriste enlaces, para armar el bloque "Para ti". Se puede desactivar y, al hacerlo, borramos el historial medido.',
          'Avisos: si activas las notificaciones, guardamos la dirección técnica de envío de tu navegador o dispositivo.',
          'Pagos (dueños de locales que impulsan): el historial del pedido y el estado del pago. Los datos de la tarjeta quedan solo con el procesador de pagos, nunca con nosotros.',
          'Datos técnicos: la dirección IP, usada para seguridad y para limitar intentos abusivos. Este control se mantiene solo en la memoria del servidor, por poco tiempo.',
        ],
      },
      {
        title: '3. Para qué los usamos y base legal',
        items: [
          'Crear y mantener tu cuenta, mostrar tu perfil y permitir chats, planes y eventos: ejecución del contrato (Términos de Uso).',
          'Mostrar lugares y eventos cerca de ti y usar tu región para anuncios por región: consentimiento, dado cuando permites la ubicación o tocas "Usar mi ubicación actual". Puedes revocarlo cuando quieras.',
          'Recomendaciones según tu uso: interés legítimo y, cuando se exija, consentimiento. Hay un interruptor para desactivarlo en Privacidad.',
          'Seguridad, prevención de fraude y abuso, y limitar intentos de acceso indebido: interés legítimo y protección del crédito y de la seguridad.',
          'Enviar códigos y avisos por correo necesarios para el servicio: ejecución del contrato.',
          'Cumplir obligaciones legales y responder a órdenes de autoridades: obligación legal.',
        ],
      },
      {
        title: '4. Quién ve qué',
        text: [
          'Tu perfil, publicaciones y eventos aparecen a las personas según tu configuración. Con el perfil privado, solo quien apruebas ve los eventos que publicas, tu agenda y tus conexiones. Los mensajes solo llegan a quienes participan en la conversación.',
          'No vendemos tus datos personales y no usamos lo que haces en AskouT para anuncios de terceros.',
        ],
      },
      {
        title: '5. Con quién compartimos para que el servicio funcione',
        items: [
          'Alojamiento y base de datos (Railway) y red, DNS y alojamiento del sitio (Cloudflare): guardan y entregan los datos de la aplicación.',
          'Envío de correo (Resend): recibe tu correo y el texto del código o aviso.',
          'Búsqueda de lugares (Google Places y OpenStreetMap): reciben la región aproximada de tu consulta para devolver los lugares cercanos, sin tu nombre ni tu cuenta.',
          'Mapa: el proveedor de mapas recibe tu IP y el área del mapa que estás viendo.',
          'Pagos (Stripe, y las tiendas de Apple y Google en la aplicación): procesan el cobro del impulso.',
          'Entrar con Google o Apple: ellos saben que entraste en AskouT.',
          'Autoridades, cuando haya orden legal.',
        ],
      },
      {
        title: '6. Transferencia fuera de Brasil',
        text: ['Algunos de estos proveedores guardan o procesan datos en otros países. Cuando esto ocurre, buscamos proveedores que ofrezcan protección adecuada y contratos compatibles con la LGPD.'],
      },
      {
        title: '7. Por cuánto tiempo los guardamos',
        items: [
          'Los datos de la cuenta y del contenido permanecen mientras la cuenta exista, o hasta que borres el contenido.',
          'Los códigos de confirmación vencen en pocos minutos. La disponibilidad "Flash" desaparece sola al vencer.',
          'El historial de tiempo por contenido y la región pueden ser borrados por ti en cualquier momento en Privacidad.',
          'Podemos mantener lo mínimo necesario por más tiempo cuando la ley lo exija (por ejemplo, registros fiscales de pagos) o para defensa en procesos.',
        ],
      },
      {
        title: '8. Tus derechos',
        text: [
          'Según la LGPD, puedes pedir: confirmación de que tratamos tus datos; acceso; corrección; anonimización, bloqueo o eliminación de datos innecesarios o tratados fuera de la ley; portabilidad; información sobre con quién compartimos; eliminación de los datos tratados con consentimiento; y revocar el consentimiento. También puedes oponerte a un tratamiento y pedir revisión de decisiones automatizadas.',
          `Parte de esto lo haces tú mismo en la app, en Privacidad: editar el perfil, hacer el perfil privado, bloquear personas, desactivar las recomendaciones, borrar la región y el historial de uso, descargar una copia de tus datos y borrar tu cuenta. Al borrar la cuenta, eliminamos tu perfil, publicaciones, comentarios, mensajes, agenda y demás datos vinculados a ella. Para otras solicitudes, escribe a ${email}. Respondemos en hasta 15 días.`,
          'Si crees que tus datos fueron tratados de forma incorrecta, también puedes reclamar ante la Autoridad Nacional de Protección de Datos de Brasil (ANPD).',
        ],
      },
      {
        title: '9. Seguridad',
        text: ['Usamos conexión cifrada (HTTPS), guardamos las contraseñas de forma irreversible, limitamos los intentos de acceso y restringimos qué miembros del equipo acceden a los datos. Ningún sistema es totalmente seguro: si ocurre un incidente que pueda causarte un riesgo relevante, te avisaremos a ti y a la ANPD, como determina la ley.'],
      },
      {
        title: '10. Niños y adolescentes',
        text: ['AskouT es solo para personas de 18 años o más, y el registro no acepta a quien tenga menos. No queremos datos de menores de 18 años: si sabemos que una cuenta es de alguien por debajo de esa edad, la cerraremos. [A revisar con un abogado antes del lanzamiento: reglas del ECA Digital de Brasil (Ley 15.211/2025).]'],
      },
      {
        title: '11. Almacenamiento en el dispositivo',
        text: ['Guardamos en tu dispositivo solo lo necesario para que la app funcione: sesión de inicio, tema y preferencias. No usamos cookies de publicidad ni rastreadores de terceros para anuncios.'],
      },
      {
        title: '12. Cambios en esta política',
        text: [`Podemos actualizar esta política. Cuando el cambio sea relevante, avisaremos en la aplicación. La fecha de la versión está en la parte superior de esta página. Última actualización: ${LEGAL_UPDATED_ES}.`],
      },
    ],
  };
}

export function buildTermsEs(email: string): LegalDoc {
  return {
    title: 'Términos de Uso',
    notice: NOTICE,
    updated: LEGAL_UPDATED_ES,
    intro: `Estos términos valen para quien usa AskouT, operado por ${COMPANY.name}, CNPJ ${COMPANY.cnpj}, ${COMPANY.address}. Al crear una cuenta o entrar, aceptas estos términos y la Política de Privacidad.`,
    blocks: [
      {
        title: '1. Qué es AskouT',
        text: ['Una aplicación para organizar encuentros presenciales con amigos y descubrir bares, locales y eventos. Dos perfiles que se siguen mutuamente son "amigos" aquí.'],
      },
      {
        title: '2. Tu cuenta',
        items: [
          'Debes tener 18 años o más para tener una cuenta e informar datos verdaderos, incluida la fecha de nacimiento.',
          'Eres responsable de tu contraseña y de todo lo que ocurra en tu cuenta. Avísanos si crees que alguien la usó.',
          'Cada persona puede tener una cuenta. Las cuentas falsas, que imitan a otras personas o se hacen para engañar, pueden ser eliminadas.',
        ],
      },
      {
        title: '3. Tu contenido',
        text: [
          'Las fotos, videos, textos y mensajes que publicas siguen siendo tuyos. Nos das un permiso limitado, gratuito y solo para operar el servicio, para guardar y mostrar ese contenido a las personas que elijas, según tu configuración de privacidad.',
          'Garantizas que tienes derecho a publicar lo que publicas, incluidas imágenes de otras personas.',
        ],
      },
      {
        title: '4. Lo que no está permitido',
        items: [
          'Acosar, amenazar, discriminar o exponer a otras personas, y publicar contenido sexual que involucre a menores o sin consentimiento (que siempre será eliminado y podrá ser comunicado a las autoridades).',
          'Publicar datos personales de terceros, o usar la app para estafas, spam o publicidad no autorizada.',
          'Intentar burlar la seguridad, adivinar contraseñas, recopilar datos en masa o usar robots sin autorización.',
          'Violar la ley o los derechos de terceros.',
        ],
        text: ['Tolerancia cero: el contenido ofensivo, de odio, violento o sexual y los usuarios abusivos no se toleran. El contenido será eliminado y quien lo publicó podrá tener la cuenta suspendida o eliminada.'],
      },
      {
        title: '5. Denuncias, bloqueo y moderación',
        items: [
          'Puedes denunciar perfiles, publicaciones, comentarios, historias y conversaciones desde la propia app (menú de opciones de cada elemento) y bloquear a cualquier persona en cualquier momento.',
          'Nuestro equipo revisa las denuncias en hasta 24 horas, elimina el contenido que incumpla estos términos y expulsa de la plataforma a quien lo publicó. Bloquear a alguien también avisa a nuestro equipo y hace que el contenido de esa persona desaparezca de tu feed al instante.',
          `Para denuncias que no quepan en la app o casos urgentes, escribe a ${email}.`,
        ],
      },
      {
        title: '6. Locales, eventos y enlaces de terceros',
        text: [
          'La información de locales y eventos proviene de dueños de locales, de fuentes públicas y de otros usuarios, y puede estar desactualizada o ser incorrecta. Confirma el horario y la dirección antes de salir. Los elementos marcados como "[TESTE]" son solo ejemplos.',
          'El botón "Comprar entrada" te lleva al sitio de venta de terceros. AskouT no vende, no cobra ni entrega entradas, y no responde por ese sitio ni por la compra.',
          'Los encuentros presenciales implican riesgos. Usa el sentido común, queda en lugares públicos y cuida tu seguridad y la de quienes te acompañan.',
        ],
      },
      {
        title: '7. Dueños de locales e impulso',
        text: ['Quien administra un local declara tener autorización para ello. El impulso es un anuncio pagado, siempre identificado como "Patrocinado". Los precios, la forma de cobro y las reglas de cancelación y reembolso se muestran antes de la compra. Reembolso: si el impulso aún no comenzó a mostrarse, puedes cancelar y recibir el valor de vuelta; también vale el plazo de arrepentimiento de 7 días del Código de Defensa del Consumidor de Brasil para compras realizadas fuera de una tienda física. Si una falla nuestra impide la exhibición, devolvemos el valor proporcional al período no entregado. Las compras hechas por Apple o Google siguen también las reglas de reembolso de la tienda. [A revisar con un abogado antes del lanzamiento.]'],
      },
      {
        title: '8. Suspensión y cierre',
        text: ['Puedes dejar de usar AskouT cuando quieras y pedir la eliminación de la cuenta por el correo de privacidad. Podemos suspender o cerrar cuentas que incumplan estos términos, con aviso cuando sea posible.'],
      },
      {
        title: '9. Responsabilidad',
        text: ['Ofrecemos AskouT tal como está, y nos esforzamos por mantenerlo en línea y seguro, pero no garantizamos que nunca tendrá fallas. En la medida permitida por la ley, no respondemos por encuentros entre usuarios, por contenido de terceros ni por perjuicios indirectos. Nada aquí limita derechos que la ley te garantiza como consumidor.'],
      },
      {
        title: '10. Cambios, ley y jurisdicción',
        text: [
          `Podemos actualizar estos términos y avisaremos en la aplicación cuando el cambio sea relevante. Última actualización: ${LEGAL_UPDATED_ES}.`,
          'Se aplican las leyes de Brasil. Se elige el foro del domicilio del consumidor para resolver conflictos.',
          `Dudas: ${email}.`,
        ],
      },
    ],
  };
}
