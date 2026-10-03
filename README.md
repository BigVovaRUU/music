<p align="center">
  <img src="./assets/icon-master.png" width="132" alt="Логотип расширения «Тихий кадр»: полумесяц и звуковые волны" />
</p>

<h1 align="center">Тихий кадр</h1>

<p align="center">
  Фоновая музыка без пауз для спокойного чтения манги.<br />
  Локально, минималистично и без отправки файлов в облако.
</p>

<p align="center">
  <a href="https://github.com/BigVovaRUU/music/releases"><img alt="Версия 1.0.1" src="https://img.shields.io/badge/version-1.0.1-D55747?style=flat-square" /></a>
  <img alt="Chrome Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest_V3-EFE6D8?style=flat-square&logo=googlechrome&logoColor=101414" />
  <img alt="Минимальная версия Chrome 109" src="https://img.shields.io/badge/Chrome-109%2B-4285F4?style=flat-square&logo=googlechrome&logoColor=white" />
  <img alt="Vanilla JavaScript" src="https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?style=flat-square&logo=javascript&logoColor=101414" />
  <img alt="Данные хранятся локально" src="https://img.shields.io/badge/privacy-local_only-4C8C6C?style=flat-square" />
</p>

<p align="center">
  <a href="https://github.com/BigVovaRUU/music/archive/refs/heads/main.zip"><strong>Скачать исходный код</strong></a>
  ·
  <a href="https://github.com/BigVovaRUU/music/issues">Сообщить об ошибке</a>
  ·
  <a href="https://github.com/BigVovaRUU/music/issues/new">Предложить идею</a>
</p>

<p align="center">
  <img src="./design/popup-implementation.png" width="400" alt="Интерфейс Chrome-расширения «Тихий кадр»" />
</p>

## О проекте

**Тихий кадр** — компактный музыкальный проигрыватель для Chrome, созданный для чтения манги, ранобэ и других занятий, где нужна ненавязчивая фоновая атмосфера.

Добавьте аудиофайл, запустите воспроизведение и закройте popup: музыка продолжит играть в фоне. Трек повторяется через Web Audio без паузы между окончанием и новым циклом.

> [!IMPORTANT]
> Музыка не загружается на сервер. Аудиофайлы и состояние проигрывателя хранятся только в локальном профиле Chrome.

## Возможности

| Возможность | Как это работает |
| --- | --- |
| Непрерывный повтор | `AudioBufferSourceNode` воспроизводит один трек в режиме loop |
| Фоновое воспроизведение | Offscreen-документ продолжает работу после закрытия popup |
| Локальная библиотека | Файлы сохраняются в IndexedDB внутри профиля расширения |
| Управление проигрывателем | Play/pause, перемотка, громкость, предыдущий и следующий трек |
| Несколько аудиофайлов | Можно добавить сразу несколько треков и переключаться между ними |
| Приватность | Нет аналитики, аккаунтов, внешних API и отправки файлов в сеть |
| Доступность | Семантическая разметка, keyboard focus и поддержка `prefers-reduced-motion` |

## Быстрый старт

### Вариант 1 — скачать репозиторий

1. [Скачайте ZIP-архив ветки `main`](https://github.com/BigVovaRUU/music/archive/refs/heads/main.zip).
2. Распакуйте архив в отдельную папку.
3. Откройте в Chrome страницу `chrome://extensions`.
4. Включите **Режим разработчика**.
5. Нажмите **Загрузить распакованное расширение**.
6. Выберите распакованную папку проекта.
7. Закрепите «Тихий кадр» на панели Chrome.

### Вариант 2 — клонировать через Git

```bash
git clone https://github.com/BigVovaRUU/music.git
cd music
```

Затем загрузите папку проекта через `chrome://extensions` → **Загрузить распакованное расширение**.

### Обновление локальной версии

После получения свежих изменений откройте `chrome://extensions` и нажмите круговую стрелку на карточке расширения или кнопку **Обновить**.

## Как пользоваться

1. Откройте popup расширения.
2. Нажмите **Добавить трек** и выберите один или несколько аудиофайлов.
3. Выберите композицию в библиотеке и нажмите Play.
4. Настройте громкость и позицию воспроизведения.
5. Закройте popup и продолжайте читать — музыка останется в фоне.

## Архитектура

```mermaid
flowchart LR
    U[Пользователь] -->|добавляет трек| P[Popup UI]
    P -->|Blob + метаданные| IDB[(IndexedDB)]
    P -->|play / pause / seek| SW[Service Worker]
    SW -->|команды через runtime| O[Offscreen Document]
    O -->|читает аудиофайл| IDB
    O --> WA[Web Audio API]
    WA -->|loop| A[Аудиовыход]
    O -->|playback state| SW
    SW --> CS[(chrome.storage.local)]
    SW -->|обновление состояния| P

    classDef accent fill:#d55747,color:#fff,stroke:#ef6a58;
    classDef storage fill:#201b19,color:#efe6d8,stroke:#716e69;
    class P,SW,O accent;
    class IDB,CS storage;
```

### Поток воспроизведения

```mermaid
sequenceDiagram
    actor Reader as Читатель
    participant Popup as Popup
    participant Worker as Service Worker
    participant Audio as Offscreen Audio
    participant DB as IndexedDB

    Reader->>Popup: Выбирает трек
    Popup->>Worker: play-track(trackId)
    Worker->>Audio: Команда воспроизведения
    Audio->>DB: Получить Blob
    DB-->>Audio: Аудиофайл
    Audio->>Audio: decodeAudioData + loop
    Audio-->>Worker: Playback state
    Worker-->>Popup: Прогресс и состояние
```

## Разрешения Chrome

Расширение запрашивает только два разрешения:

| Разрешение | Назначение |
| --- | --- |
| `offscreen` | Воспроизведение музыки после закрытия popup |
| `storage` | Сохранение громкости, позиции и состояния проигрывателя |

Доступ к истории, вкладкам, содержимому сайтов, камере, микрофону и сетевым запросам не требуется.

## Технологии

- Chrome Extension Manifest V3;
- Web Audio API;
- Offscreen Documents API;
- IndexedDB;
- `chrome.storage.local`;
- Vanilla JavaScript, HTML и CSS — без сборщика и runtime-зависимостей.

## Структура проекта

```text
music/
├── assets/
│   ├── icons/                 # Иконки Chrome: 16, 32, 48 и 128 px
│   └── night-cover-512.png    # Обложка проигрывателя
├── design/
│   ├── popup-concept.png      # Исходный визуальный концепт
│   └── popup-implementation.png
├── db.js                      # Работа с IndexedDB
├── manifest.json              # Manifest V3 и разрешения
├── offscreen.html
├── offscreen.js               # Декодирование и loop через Web Audio
├── popup.html
├── popup.css
├── popup.js                   # Интерфейс и библиотека треков
├── service-worker.js          # Маршрутизация команд и состояния
└── README.md
```

## Локальная проверка

Проект не требует установки зависимостей. Для быстрой проверки синтаксиса:

```bash
node --check popup.js
node --check service-worker.js
node --check offscreen.js
```

После изменений обновите расширение на `chrome://extensions` и проверьте сценарий:

```text
добавить аудиофайл → запустить → закрыть popup → открыть снова → поставить на паузу
```

## Визуальное направление

Интерфейс построен вокруг спокойной ночной эстетики: графитовый фон, оттенок рисовой бумаги, приглушённый киноварный акцент и типографика с редакционным характером. Иконка и иллюстрация созданы специально для проекта.

<details>
  <summary><strong>Посмотреть исходный дизайн и реализацию</strong></summary>
  <br />
  <p align="center">
    <img src="./design/popup-concept.png" width="46%" alt="Исходный визуальный концепт расширения" />
    &nbsp;&nbsp;
    <img src="./design/popup-implementation.png" width="36%" alt="Реализованный интерфейс расширения" />
  </p>
</details>

## Roadmap

- [x] Локальная библиотека аудиофайлов
- [x] Фоновое воспроизведение
- [x] Непрерывный loop одного трека
- [x] Громкость, перемотка и переключение композиций
- [ ] Плейлисты для разных жанров манги
- [ ] Fade-in и fade-out
- [ ] Горячие клавиши
- [ ] Импорт и экспорт настроек
- [ ] Публикация в Chrome Web Store

## Участие в разработке

Идеи, сообщения об ошибках и pull request приветствуются.

1. Сделайте fork репозитория.
2. Создайте ветку: `git switch -c feature/my-idea`.
3. Внесите изменение и проверьте расширение локально.
4. Создайте commit с понятным описанием.
5. Откройте pull request в `main`.

Перед созданием issue проверьте [существующие обсуждения](https://github.com/BigVovaRUU/music/issues). Для ошибки укажите версию Chrome, шаги воспроизведения и приложите скриншот страницы `chrome://extensions` при наличии ошибки.

## FAQ

<details>
  <summary><strong>Продолжит ли музыка играть после закрытия popup?</strong></summary>
  <br />
  Да. За воспроизведение отвечает отдельный offscreen-документ Chrome.
</details>

<details>
  <summary><strong>Куда загружаются мои треки?</strong></summary>
  <br />
  Никуда. Они сохраняются локально в IndexedDB профиля расширения.
</details>

<details>
  <summary><strong>Почему после изменения кода интерфейс не обновился?</strong></summary>
  <br />
  Chrome кэширует загруженное расширение. Нажмите кнопку обновления на странице <code>chrome://extensions</code>.
</details>

<details>
  <summary><strong>Какие форматы поддерживаются?</strong></summary>
  <br />
  Расширение принимает аудиоформаты, которые умеет декодировать установленная версия Chrome, включая распространённые MP3, WAV, OGG и M4A/AAC.
</details>

## Лицензия

Лицензия пока не выбрана. До добавления файла `LICENSE` исходный код доступен для просмотра, однако стандартные права на копирование, изменение и распространение автоматически не предоставляются.

Если проект должен стать полноценным open-source, перед публикацией выберите подходящую лицензию — например, MIT или Apache-2.0 — и добавьте её отдельным файлом.

---

<p align="center">
  Сделано для тех моментов, когда история остаётся в центре внимания, а музыка — рядом.
</p>
