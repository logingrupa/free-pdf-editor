// Editor UI strings for every locale, picked by <html lang>.
// Landing page copy is content and lives in each locale's HTML instead.
// A classic script so theme.js can label the toggle before the first paint
// and so the ES modules can read it without an import graph.
(function () {
  var STRINGS = {
    en: {
      'theme.toDark': 'Switch to dark theme',
      'theme.toLight': 'Switch to light theme',
      'theme.toggle': 'Switch theme',
      'nav.language': 'Language',

      'app.backHome': 'Back to the Edit PDF home page',
      'app.rename': 'Click to rename',
      'app.undo': 'Undo (Ctrl+Z)',
      'app.redo': 'Redo (Ctrl+Shift+Z)',
      'app.zoomOut': 'Zoom out (Ctrl -)',
      'app.zoomIn': 'Zoom in (Ctrl +)',
      'app.zoomReset': 'Reset zoom',
      'app.close': 'Close',
      'app.closeTitle': 'Close and start over',
      'app.download': 'Download',
      'app.tools': 'Tools',
      'app.pages': 'Pages',
      'app.side': 'Pages and layers',
      'app.sideHide': 'Hide the panel',
      'app.sideShow': 'Show pages and layers',
      'app.pin': 'Keep this tab open',
      'app.unpin': 'Let the tab follow the work',
      'app.layers': 'Layers',
      'app.objectActions': 'Object actions',
      'app.pageActions': 'Page actions',
      'app.layersHint': 'Drag to restack. The top row draws last.',
      'app.layersEmpty': 'Nothing on this page yet.',
      'app.layersPage': 'Page {n}',
      'app.properties': 'Properties',

      'tool.edit': 'Edit the text already on the page (E)',
      'tool.select': 'Select / move (V)',
      'tool.text': 'Text (T)',
      'tool.pen': 'Draw (P)',
      'tool.highlight': 'Highlight (H)',
      'tool.rect': 'Rectangle (R)',
      'tool.ellipse': 'Ellipse (O)',
      'tool.arrow': 'Arrow (A)',
      'tool.whiteout': 'White-out cover (W)',
      'tool.image': 'Place image or signature (I)',

      'drop.title': 'Drop a PDF here',
      'drop.body': 'Annotate it, then download. The file never leaves this device - no upload, no server, no account.',
      'drop.pick': 'Choose PDF',
      'drop.hint': 'Work is auto-saved in this browser, so a refresh will not lose it.',

      'msg.notPdf': 'That is not a PDF',
      'msg.reading': 'Reading PDF...',
      'msg.openFailed': 'Could not open that PDF',
      'msg.added': {
        one: 'Added {n} page from {name}',
        other: 'Added {n} pages from {name}',
      },
      'msg.restored': 'Restored {name} from {time}',
      'msg.working': 'Working...',
      'msg.building': 'Building PDF...',
      'msg.downloaded': 'Downloaded {name}',
      'msg.exportFailed': 'Export failed: {err}',
      'msg.placeImage': 'Click on the page to place it',
      'msg.lastPage': 'That is the last page',
      'msg.closeConfirm': 'Close this document? Saved work in this browser is cleared.',
      'msg.pageCount': { one: '{n} page', other: '{n} pages' },

      'save.saving': 'Saving...',
      'save.saved': 'Saved {time}',
      'save.failed': 'Not saved',

      'prop.selected': 'Selected {name}',
      'prop.colour': 'Colour',
      'prop.fill': 'Fill',
      'prop.stroke': 'Stroke',
      'prop.opacity': 'Opacity',
      'prop.size': 'Size',
      'prop.font': 'Font',
      'prop.style': 'Style',
      'prop.align': 'Align',
      'prop.delete': 'Delete',
      'prop.duplicate': 'Duplicate',
      'prop.forward': 'Bring forward',
      'prop.backward': 'Send back',
      'prop.editText': 'Edit text',
      'prop.noFill': 'No fill',
      'prop.customColour': 'Custom colour',
      'prop.bold': 'Bold',
      'prop.boldLetter': 'B',
      'prop.italic': 'Italic',
      'prop.italicLetter': 'I',
      'prop.alignLeft': 'Align left',
      'prop.alignCenter': 'Align centre',
      'prop.alignRight': 'Align right',
      'prop.alignJustify': 'Justify',
      'prop.lineHeight': 'Line height',
      'prop.box': 'Box',
      'prop.background': 'Background',
      'prop.border': 'Border',
      'prop.borderWidth': 'Border width',
      'prop.radius': 'Corner',
      'prop.padding': 'Padding',
      'prop.shadow': 'Shadow',
      'prop.shadowColour': 'Shadow colour',
      'prop.boxHint': 'Padding pushes the box out around the text. A page has no outer margins, so drag the box to move it.',

      'type.edit': 'Edit text',
      'type.select': 'Select',
      'type.text': 'text box',
      'type.etext': 'page text',
      'type.pen': 'Draw',
      'type.highlight': 'Highlight',
      'type.rect': 'Rectangle',
      'type.ellipse': 'Ellipse',
      'type.arrow': 'Arrow',
      'type.whiteout': 'White-out',
      'type.image': 'Image',

      'tip.annot': 'Drag to move, side handles to set the wrapping width. Delete key removes it.',
      'tip.edit': 'Click any line of text on the page to rewrite it. The original line is covered with its own background colour.',
      'tip.select': 'Click something on the page to move or restyle it. Drop another PDF to append its pages.',
      'tip.draw': 'Drag on the page to draw. Press E to go back to editing text.',

      'thumb.rotL': 'Rotate left',
      'thumb.rotR': 'Rotate right',
      'thumb.del': 'Delete page',
      'thumb.dup': 'Duplicate page',
    },

    lv: {
      'theme.toDark': 'Pārslēgt uz tumšo tēmu',
      'theme.toLight': 'Pārslēgt uz gaišo tēmu',
      'theme.toggle': 'Pārslēgt tēmu',
      'nav.language': 'Valoda',

      'app.backHome': 'Atpakaļ uz Edit PDF sākumlapu',
      'app.rename': 'Noklikšķiniet, lai pārdēvētu',
      'app.undo': 'Atsaukt (Ctrl+Z)',
      'app.redo': 'Atcelt atsaukšanu (Ctrl+Shift+Z)',
      'app.zoomOut': 'Tālināt (Ctrl -)',
      'app.zoomIn': 'Tuvināt (Ctrl +)',
      'app.zoomReset': 'Atiestatīt mērogu',
      'app.close': 'Aizvērt',
      'app.closeTitle': 'Aizvērt un sākt no jauna',
      'app.download': 'Lejupielādēt',
      'app.tools': 'Rīki',
      'app.pages': 'Lappuses',
      'app.side': 'Lappuses un slāņi',
      'app.sideHide': 'Paslēpt paneli',
      'app.sideShow': 'Rādīt lappuses un slāņus',
      'app.pin': 'Paturēt šo cilni atvērtu',
      'app.unpin': 'Ļaut cilnei sekot darbam',
      'app.layers': 'Slāņi',
      'app.objectActions': 'Objekta darbības',
      'app.pageActions': 'Lappuses darbības',
      'app.layersHint': 'Velciet, lai mainītu kārtību. Augšējā rinda zīmējas pēdējā.',
      'app.layersEmpty': 'Šajā lappusē vēl nekā nav.',
      'app.layersPage': '{n}. lappuse',
      'app.properties': 'Īpašības',

      'tool.edit': 'Rediģēt tekstu, kas jau ir lapā (E)',
      'tool.select': 'Atlasīt un pārvietot (V)',
      'tool.text': 'Teksts (T)',
      'tool.pen': 'Zīmēt (P)',
      'tool.highlight': 'Izcelt (H)',
      'tool.rect': 'Taisnstūris (R)',
      'tool.ellipse': 'Elipse (O)',
      'tool.arrow': 'Bulta (A)',
      'tool.whiteout': 'Nosegt ar balto (W)',
      'tool.image': 'Ievietot attēlu vai parakstu (I)',

      'drop.title': 'Ievelciet PDF šeit',
      'drop.body': 'Papildiniet to un lejupielādējiet. Fails neatstāj šo ierīci - bez augšupielādes, bez servera, bez konta.',
      'drop.pick': 'Izvēlēties PDF',
      'drop.hint': 'Darbs tiek saglabāts šajā pārlūkā, tāpēc lapas pārlāde to nezaudēs.',

      'msg.notPdf': 'Tas nav PDF',
      'msg.reading': 'Nolasa PDF...',
      'msg.openFailed': 'Neizdevās atvērt šo PDF',
      'msg.added': {
        zero: 'Pievienots: {n} lappušu no {name}',
        one: 'Pievienots: {n} lappuse no {name}',
        other: 'Pievienots: {n} lappuses no {name}',
      },
      'msg.restored': 'Atjaunots {name} no {time}',
      'msg.working': 'Notiek darbs...',
      'msg.building': 'Veido PDF...',
      'msg.downloaded': 'Lejupielādēts {name}',
      'msg.exportFailed': 'Eksports neizdevās: {err}',
      'msg.placeImage': 'Noklikšķiniet uz lapas, lai to novietotu',
      'msg.lastPage': 'Šī ir pēdējā lappuse',
      'msg.closeConfirm': 'Aizvērt šo dokumentu? Šajā pārlūkā saglabātais darbs tiks dzēsts.',
      'msg.pageCount': { zero: '{n} lappušu', one: '{n} lappuse', other: '{n} lappuses' },

      'save.saving': 'Saglabā...',
      'save.saved': 'Saglabāts {time}',
      'save.failed': 'Nav saglabāts',

      'prop.selected': 'Atlasīts: {name}',
      'prop.colour': 'Krāsa',
      'prop.fill': 'Aizpildījums',
      'prop.stroke': 'Biezums',
      'prop.opacity': 'Necaurredzamība',
      'prop.size': 'Izmērs',
      'prop.font': 'Fonts',
      'prop.style': 'Stils',
      'prop.align': 'Līdzinājums',
      'prop.delete': 'Dzēst',
      'prop.duplicate': 'Dublēt',
      'prop.forward': 'Pārvietot uz priekšu',
      'prop.backward': 'Pārvietot atpakaļ',
      'prop.editText': 'Rediģēt tekstu',
      'prop.noFill': 'Bez aizpildījuma',
      'prop.customColour': 'Pielāgota krāsa',
      'prop.bold': 'Treknraksts',
      'prop.boldLetter': 'B',
      'prop.italic': 'Kursīvs',
      'prop.italicLetter': 'I',
      'prop.alignLeft': 'Līdzināt pa kreisi',
      'prop.alignCenter': 'Centrēt',
      'prop.alignRight': 'Līdzināt pa labi',
      'prop.alignJustify': 'Taisnot abās malās',
      'prop.lineHeight': 'Rindstarpa',
      'prop.box': 'Kaste',
      'prop.background': 'Fons',
      'prop.border': 'Apmale',
      'prop.borderWidth': 'Apmales biezums',
      'prop.radius': 'Stūris',
      'prop.padding': 'Atkāpe',
      'prop.shadow': 'Ēna',
      'prop.shadowColour': 'Ēnas krāsa',
      'prop.boxHint': 'Atkāpe izpleš kasti ap tekstu. Lappusei nav ārējo atstarpju, tāpēc kasti pārvieto ar vilkšanu.',

      'type.edit': 'Rediģēt tekstu',
      'type.select': 'Atlasīt',
      'type.text': 'teksta lauks',
      'type.etext': 'lapas teksts',
      'type.pen': 'Zīmējums',
      'type.highlight': 'Izcēlums',
      'type.rect': 'Taisnstūris',
      'type.ellipse': 'Elipse',
      'type.arrow': 'Bulta',
      'type.whiteout': 'Baltais nosegums',
      'type.image': 'Attēls',

      'tip.annot': 'Velciet, lai pārvietotu. Sānu turi nosaka teksta aplaušanas platumu, taustiņš Delete to dzēš.',
      'tip.edit': 'Noklikšķiniet uz jebkuras teksta rindas lapā, lai to pārrakstītu. Sākotnējā rinda tiek nosegta ar tās pašas fona krāsu.',
      'tip.select': 'Noklikšķiniet uz objekta lapā, lai to pārvietotu vai mainītu tā stilu. Ievelciet vēl vienu PDF, lai pievienotu tā lappuses.',
      'tip.draw': 'Velciet pa lapu, lai zīmētu. Nospiediet E, lai atgrieztos pie teksta rediģēšanas.',

      'thumb.rotL': 'Pagriezt pa kreisi',
      'thumb.rotR': 'Pagriezt pa labi',
      'thumb.del': 'Dzēst lappusi',
      'thumb.dup': 'Dublēt lappusi',
    },

    ru: {
      'theme.toDark': 'Переключить на тёмную тему',
      'theme.toLight': 'Переключить на светлую тему',
      'theme.toggle': 'Переключить тему',
      'nav.language': 'Язык',

      'app.backHome': 'Вернуться на главную страницу Edit PDF',
      'app.rename': 'Нажмите, чтобы переименовать',
      'app.undo': 'Отменить (Ctrl+Z)',
      'app.redo': 'Вернуть (Ctrl+Shift+Z)',
      'app.zoomOut': 'Уменьшить (Ctrl -)',
      'app.zoomIn': 'Увеличить (Ctrl +)',
      'app.zoomReset': 'Сбросить масштаб',
      'app.close': 'Закрыть',
      'app.closeTitle': 'Закрыть и начать заново',
      'app.download': 'Скачать',
      'app.tools': 'Инструменты',
      'app.pages': 'Страницы',
      'app.side': 'Страницы и слои',
      'app.sideHide': 'Скрыть панель',
      'app.sideShow': 'Показать страницы и слои',
      'app.pin': 'Закрепить эту вкладку',
      'app.unpin': 'Пусть вкладка следует за работой',
      'app.layers': 'Слои',
      'app.objectActions': 'Действия с объектом',
      'app.pageActions': 'Действия со страницей',
      'app.layersHint': 'Перетащите, чтобы изменить порядок. Верхняя строка рисуется последней.',
      'app.layersEmpty': 'На этой странице пока ничего нет.',
      'app.layersPage': 'Страница {n}',
      'app.properties': 'Свойства',

      'tool.edit': 'Изменить текст, который уже есть на странице (E)',
      'tool.select': 'Выделить и переместить (V)',
      'tool.text': 'Текст (T)',
      'tool.pen': 'Рисовать (P)',
      'tool.highlight': 'Выделить цветом (H)',
      'tool.rect': 'Прямоугольник (R)',
      'tool.ellipse': 'Эллипс (O)',
      'tool.arrow': 'Стрелка (A)',
      'tool.whiteout': 'Закрасить белым (W)',
      'tool.image': 'Вставить изображение или подпись (I)',

      'drop.title': 'Перетащите PDF сюда',
      'drop.body': 'Отредактируйте и скачайте. Файл не покидает это устройство - без загрузки на сервер, без регистрации.',
      'drop.pick': 'Выбрать PDF',
      'drop.hint': 'Работа сохраняется в этом браузере, поэтому перезагрузка страницы её не потеряет.',

      'msg.notPdf': 'Это не PDF',
      'msg.reading': 'Чтение PDF...',
      'msg.openFailed': 'Не удалось открыть этот PDF',
      'msg.added': {
        one: 'Добавлена {n} страница из {name}',
        few: 'Добавлено {n} страницы из {name}',
        many: 'Добавлено {n} страниц из {name}',
        other: 'Добавлено {n} страницы из {name}',
      },
      'msg.restored': 'Восстановлен {name} от {time}',
      'msg.working': 'Обработка...',
      'msg.building': 'Сборка PDF...',
      'msg.downloaded': 'Скачано: {name}',
      'msg.exportFailed': 'Не удалось экспортировать: {err}',
      'msg.placeImage': 'Нажмите на страницу, чтобы разместить',
      'msg.lastPage': 'Это последняя страница',
      'msg.closeConfirm': 'Закрыть документ? Сохранённая в этом браузере работа будет удалена.',
      'msg.pageCount': {
        one: '{n} страница',
        few: '{n} страницы',
        many: '{n} страниц',
        other: '{n} страницы',
      },

      'save.saving': 'Сохранение...',
      'save.saved': 'Сохранено в {time}',
      'save.failed': 'Не сохранено',

      'prop.selected': 'Выбрано: {name}',
      'prop.colour': 'Цвет',
      'prop.fill': 'Заливка',
      'prop.stroke': 'Толщина',
      'prop.opacity': 'Непрозрачность',
      'prop.size': 'Размер',
      'prop.font': 'Шрифт',
      'prop.style': 'Начертание',
      'prop.align': 'Выравнивание',
      'prop.delete': 'Удалить',
      'prop.duplicate': 'Дублировать',
      'prop.forward': 'На передний план',
      'prop.backward': 'На задний план',
      'prop.editText': 'Изменить текст',
      'prop.noFill': 'Без заливки',
      'prop.customColour': 'Свой цвет',
      'prop.bold': 'Полужирный',
      'prop.boldLetter': 'Ж',
      'prop.italic': 'Курсив',
      'prop.italicLetter': 'К',
      'prop.alignLeft': 'По левому краю',
      'prop.alignCenter': 'По центру',
      'prop.alignRight': 'По правому краю',
      'prop.alignJustify': 'По ширине',
      'prop.lineHeight': 'Межстрочный интервал',
      'prop.box': 'Блок',
      'prop.background': 'Фон',
      'prop.border': 'Рамка',
      'prop.borderWidth': 'Толщина рамки',
      'prop.radius': 'Скругление',
      'prop.padding': 'Отступ',
      'prop.shadow': 'Тень',
      'prop.shadowColour': 'Цвет тени',
      'prop.boxHint': 'Отступ расширяет блок вокруг текста. Внешних полей у страницы нет, поэтому блок перемещают перетаскиванием.',

      'type.edit': 'Изменить текст',
      'type.select': 'Выделение',
      'type.text': 'текстовое поле',
      'type.etext': 'текст страницы',
      'type.pen': 'Рисование',
      'type.highlight': 'Выделение цветом',
      'type.rect': 'Прямоугольник',
      'type.ellipse': 'Эллипс',
      'type.arrow': 'Стрелка',
      'type.whiteout': 'Белая заливка',
      'type.image': 'Изображение',

      'tip.annot': 'Перетащите, чтобы переместить. Боковые маркеры задают ширину переноса, клавиша Delete удаляет объект.',
      'tip.edit': 'Нажмите на любую строку текста на странице, чтобы переписать её. Исходная строка закрывается цветом её собственного фона.',
      'tip.select': 'Нажмите на объект на странице, чтобы переместить его или изменить оформление. Перетащите другой PDF, чтобы добавить его страницы.',
      'tip.draw': 'Проведите по странице, чтобы рисовать. Нажмите E, чтобы вернуться к правке текста.',

      'thumb.rotL': 'Повернуть влево',
      'thumb.rotR': 'Повернуть вправо',
      'thumb.del': 'Удалить страницу',
      'thumb.dup': 'Дублировать страницу',
    },
  };

  var tag = document.documentElement.lang || 'en';
  var lang = tag.slice(0, 2).toLowerCase();
  var dict = STRINGS[lang] || STRINGS.en;
  var plural = new Intl.PluralRules(STRINGS[lang] ? tag : 'en');

  function t(key, vars) {
    var value = dict[key];
    if (value === undefined) value = STRINGS.en[key];
    if (value === undefined) return key;
    if (typeof value === 'object') {
      var form = plural.select(vars.n);
      value = value[form] !== undefined ? value[form] : value.other;
    }
    return vars ? value.replace(/\{(\w+)\}/g, function (all, name) {
      return vars[name] !== undefined ? vars[name] : all;
    }) : value;
  }

  // Static markup carries the translated copy already; re-applying it keeps
  // the dictionary the single source when a page and the table drift apart.
  function paintDom() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.title = t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-label]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.dataset.i18nLabel));
    });
  }

  // <details> opens the language menu on its own; it only needs dismissing.
  function wireSwitcher() {
    var menus = document.querySelectorAll('details.lang');
    if (!menus.length) return;
    function closeAll(except) {
      for (var i = 0; i < menus.length; i++) if (menus[i] !== except) menus[i].open = false;
    }
    document.addEventListener('click', function (event) {
      closeAll(event.target.closest ? event.target.closest('details.lang') : null);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeAll(null);
    });
  }

  window.i18n = { lang: lang, tag: tag, t: t };
  document.addEventListener('DOMContentLoaded', function () {
    paintDom();
    wireSwitcher();
  });
})();
