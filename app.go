package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"sort"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx       context.Context
	modelsDir string
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// Определяем каталог для хранения моделей в каталоге пользователя
	if usr, err := user.Current(); err == nil {
		a.modelsDir = filepath.Join(usr.HomeDir, ".submagic", "models")
	} else {
		// Fallback: текущий рабочий каталог
		a.modelsDir = "models"
	}
	_ = os.MkdirAll(a.modelsDir, 0755)
	log.Println("[startup] modelsDir:", a.modelsDir)
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

type WhisperModelInfo struct {
	URL  string
	Size int64 // bytes
}

var whisperModels = map[string]WhisperModelInfo{
	"tiny":             {"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin", 75 * 1024 * 1024},
	"tiny.en":          {"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin", 75 * 1024 * 1024},
	"base":             {"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin", 142 * 1024 * 1024},
	"base.en":          {"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin", 142 * 1024 * 1024},
	"small":            {"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin", 466 * 1024 * 1024},
	"small.en":         {"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin", 466 * 1024 * 1024},
	"medium":           {"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin", 1531 * 1024 * 1024},
	"medium.en":        {"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin", 1531 * 1024 * 1024},
	"large-v1":         {"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v1.bin", 2900 * 1024 * 1024},
	"large-v2":         {"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v2.bin", 2900 * 1024 * 1024},
	"large-v3":         {"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin", 2902 * 1024 * 1024},
	"distil-medium.en": {"https://huggingface.co/distil-whisper/distil-medium.en/resolve/main/ggml-distil-medium.en.bin", 418 * 1024 * 1024},
	"distil-large-v2":  {"https://huggingface.co/distil-whisper/distil-large-v2/resolve/main/ggml-distil-large-v2.bin", 1100 * 1024 * 1024},
}

func (a *App) ListModels() ([]map[string]interface{}, error) {
	log.Println("[ListModels] Получение списка моделей Whisper")
	var result []map[string]interface{}
	// Сортировка по размеру
	type modelEntry struct {
		Name string
		Info WhisperModelInfo
	}
	var models []modelEntry
	for name, info := range whisperModels {
		models = append(models, modelEntry{name, info})
	}
	// сортировка по размеру
	sort.Slice(models, func(i, j int) bool {
		return models[i].Info.Size < models[j].Info.Size
	})
	for _, m := range models {
		localPath := filepath.Join(a.modelsDir, filepath.Base(m.Info.URL))
		info, err := os.Stat(localPath)
		size := int64(0)
		if err == nil {
			size = info.Size()
		}
		result = append(result, map[string]interface{}{
			"name":         m.Name,
			"url":          m.Info.URL,
			"local":        err == nil,
			"size":         size,
			"filename":     filepath.Base(m.Info.URL),
			"expectedSize": m.Info.Size,
		})
	}
	return result, nil
}

// ProgressWriter для отслеживания прогресса загрузки
type ProgressWriter struct {
	total      int64
	written    int64
	modelName  string
	app        *App
	lastUpdate time.Time
}

func (pw *ProgressWriter) Write(p []byte) (int, error) {
	n := len(p)
	pw.written += int64(n)

	// Обновляем прогресс каждые 100ms
	now := time.Now()
	if now.Sub(pw.lastUpdate) > 100*time.Millisecond {
		percent := float64(pw.written) / float64(pw.total) * 100
		if percent > 100 {
			percent = 100
		}

		// Отправляем событие прогресса во фронтенд
		runtime.EventsEmit(pw.app.ctx, "modelDownloadProgress", map[string]interface{}{
			"name":    pw.modelName,
			"percent": int(percent),
			"written": pw.written,
			"total":   pw.total,
		})

		pw.lastUpdate = now
		log.Printf("[DownloadModel] Прогресс %s: %.1f%%\n", pw.modelName, percent)
	}

	return n, nil
}

func (a *App) DownloadModel(name string) (string, error) {
	log.Printf("[DownloadModel] Запрошено скачивание модели: %s\n", name)
	info, ok := whisperModels[name]
	if !ok {
		log.Printf("[DownloadModel] Неизвестная модель: %s\n", name)
		return "", errors.New("unknown model")
	}

	localPath := filepath.Join(a.modelsDir, filepath.Base(info.URL))

	// Проверяем, не скачана ли уже модель
	if _, err := os.Stat(localPath); err == nil {
		return localPath, nil
	}

	out, err := os.Create(localPath)
	if err != nil {
		log.Printf("[DownloadModel] Ошибка создания файла: %v\n", err)
		return "", err
	}
	defer out.Close()

	resp, err := http.Get(info.URL)
	if err != nil {
		log.Printf("[DownloadModel] Ошибка http.Get: %v\n", err)
		return "", err
	}
	defer resp.Body.Close()

	// Создаем ProgressWriter для отслеживания прогресса
	pw := &ProgressWriter{
		total:     resp.ContentLength,
		modelName: name,
		app:       a,
	}

	// Используем TeeReader для записи и отслеживания прогресса
	reader := io.TeeReader(resp.Body, pw)

	_, err = io.Copy(out, reader)
	if err != nil {
		log.Printf("[DownloadModel] Ошибка копирования: %v\n", err)
		os.Remove(localPath) // Удаляем частично скачанный файл
		return "", err
	}

	// Отправляем финальное событие завершения
	runtime.EventsEmit(a.ctx, "modelDownloadProgress", map[string]interface{}{
		"name":    name,
		"percent": 100,
		"written": pw.total,
		"total":   pw.total,
	})

	log.Printf("[DownloadModel] Модель %s успешно скачана\n", name)
	return localPath, nil
}

// DeleteModel удаляет скачанную модель
func (a *App) DeleteModel(name string) error {
	log.Printf("[DeleteModel] =======================================\n")
	log.Printf("[DeleteModel] НАЧАЛО УДАЛЕНИЯ МОДЕЛИ\n")
	log.Printf("[DeleteModel] Получен запрос на удаление модели: %s\n", name)
	log.Printf("[DeleteModel] Тип параметра name: %T\n", name)
	log.Printf("[DeleteModel] Длина имени модели: %d\n", len(name))
	log.Printf("[DeleteModel] modelsDir: %s\n", a.modelsDir)

	// Диагностика: выводим содержимое директории моделей
	dirEntries, err := os.ReadDir(a.modelsDir)
	if err != nil {
		log.Printf("[DeleteModel] ОШИБКА при чтении директории моделей: %v\n", err)
	} else {
		log.Printf("[DeleteModel] Содержимое директории моделей:")
		for _, entry := range dirEntries {
			log.Printf("[DeleteModel]   - %s", entry.Name())
		}
	}

	// Проверяем существование модели в базе данных
	info, ok := whisperModels[name]
	if !ok {
		log.Printf("[DeleteModel] ОШИБКА: Неизвестная модель: %s\n", name)
		log.Printf("[DeleteModel] Доступные модели: ")
		for modelName := range whisperModels {
			log.Printf("[DeleteModel]   - %s\n", modelName)
		}
		log.Printf("[DeleteModel] =======================================\n")
		return errors.New("unknown model")
	}

	log.Printf("[DeleteModel] Модель найдена в базе данных\n")
	log.Printf("[DeleteModel] URL модели: %s\n", info.URL)
	log.Printf("[DeleteModel] Базовое имя файла: %s\n", filepath.Base(info.URL))

	localPath := filepath.Join(a.modelsDir, filepath.Base(info.URL))
	log.Printf("[DeleteModel] Полный путь к файлу: %s\n", localPath)

	// Диагностика: проверяем, есть ли файл с таким именем в директории
	found := false
	for _, entry := range dirEntries {
		if entry.Name() == filepath.Base(info.URL) {
			found = true
			log.Printf("[DeleteModel] Файл %s найден в директории моделей", entry.Name())
		}
		if entry.Name() == name {
			log.Printf("[DeleteModel] ВНИМАНИЕ: В директории есть файл с именем, совпадающим с ключом модели: %s", entry.Name())
		}
	}
	if !found {
		log.Printf("[DeleteModel] ПРЕДУПРЕЖДЕНИЕ: Файл %s НЕ найден в директории моделей", filepath.Base(info.URL))
	}

	// Проверяем существование файла перед удалением
	if stat, err := os.Stat(localPath); err != nil {
		if os.IsNotExist(err) {
			log.Printf("[DeleteModel] ПРЕДУПРЕЖДЕНИЕ: Файл не существует: %s\n", localPath)
			log.Printf("[DeleteModel] Модель уже удалена или не была загружена\n")
			log.Printf("[DeleteModel] =======================================\n")
			return nil // Считаем успешным, если файл уже не существует
		} else {
			log.Printf("[DeleteModel] ОШИБКА при проверке файла: %v\n", err)
			log.Printf("[DeleteModel] =======================================\n")
			return err
		}
	} else {
		log.Printf("[DeleteModel] Файл существует, размер: %d байт\n", stat.Size())
		log.Printf("[DeleteModel] Время изменения: %v\n", stat.ModTime())
	}

	log.Printf("[DeleteModel] Попытка удаления файла...\n")
	err = os.Remove(localPath)
	if err != nil {
		log.Printf("[DeleteModel] ОШИБКА при удалении файла: %v\n", err)
		log.Printf("[DeleteModel] Тип ошибки: %T\n", err)
		log.Printf("[DeleteModel] =======================================\n")
		return err
	}

	log.Printf("[DeleteModel] Файл успешно удален\n")
	log.Printf("[DeleteModel] Проверка удаления...\n")

	// Дополнительная проверка что файл действительно удален
	if _, err := os.Stat(localPath); os.IsNotExist(err) {
		log.Printf("[DeleteModel] ПОДТВЕРЖДЕНИЕ: Файл действительно удален\n")
	} else if err == nil {
		log.Printf("[DeleteModel] ПРЕДУПРЕЖДЕНИЕ: Файл все еще существует после удаления\n")
	} else {
		log.Printf("[DeleteModel] Ошибка при проверке удаления: %v\n", err)
	}

	log.Printf("[DeleteModel] УСПЕШНО: Модель %s удалена\n", name)
	log.Printf("[DeleteModel] КОНЕЦ УДАЛЕНИЯ МОДЕЛИ\n")
	log.Printf("[DeleteModel] =======================================\n")
	return nil
}

// Settings структура для хранения настроек
type Settings struct {
	ActiveModel string `json:"activeModel"`
}

// getSettingsPath возвращает путь к файлу настроек
func (a *App) getSettingsPath() string {
	return "settings.json"
}

// loadSettings загружает настройки из файла
func (a *App) loadSettings() (*Settings, error) {
	settingsPath := a.getSettingsPath()
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		// Если файл не существует, возвращаем настройки по умолчанию
		if os.IsNotExist(err) {
			return &Settings{ActiveModel: "base"}, nil
		}
		return nil, err
	}

	var settings Settings
	err = json.Unmarshal(data, &settings)
	if err != nil {
		return nil, err
	}

	return &settings, nil
}

// saveSettings сохраняет настройки в файл
func (a *App) saveSettings(settings *Settings) error {
	settingsPath := a.getSettingsPath()
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(settingsPath, data, 0644)
}

// SetActiveModel устанавливает активную модель
func (a *App) SetActiveModel(name string) error {
	log.Printf("[SetActiveModel] Установка активной модели: %s\n", name)
	_, ok := whisperModels[name]
	if !ok {
		return errors.New("unknown model")
	}

	// Загружаем текущие настройки
	settings, err := a.loadSettings()
	if err != nil {
		log.Printf("[SetActiveModel] Ошибка загрузки настроек: %v\n", err)
		return err
	}

	// Обновляем активную модель
	settings.ActiveModel = name

	// Сохраняем настройки
	err = a.saveSettings(settings)
	if err != nil {
		log.Printf("[SetActiveModel] Ошибка сохранения настроек: %v\n", err)
		return err
	}

	log.Printf("[SetActiveModel] Активная модель установлена: %s\n", name)
	return nil
}

// GetActiveModel возвращает название активной модели
func (a *App) GetActiveModel() (string, error) {
	settings, err := a.loadSettings()
	if err != nil {
		log.Printf("[GetActiveModel] Ошибка загрузки настроек: %v\n", err)
		return "base", nil // Возвращаем дефолтную модель при ошибке
	}

	log.Printf("[GetActiveModel] Активная модель: %s\n", settings.ActiveModel)
	return settings.ActiveModel, nil
}

func (a *App) GenerateSubtitles(ctx context.Context, filePath string, lang string, modelName string) (string, error) {
	log.Printf("[GenerateSubtitles] Генерация субтитров: файл=%s, язык=%s, модель=%s\n", filePath, lang, modelName)
	info, ok := whisperModels[modelName]
	if !ok {
		log.Printf("[GenerateSubtitles] Неизвестная модель: %s\n", modelName)
		return "", errors.New("unknown model")
	}
	modelPath := filepath.Join(a.modelsDir, filepath.Base(info.URL))
	if _, err := os.Stat(modelPath); err != nil {
		log.Printf("[GenerateSubtitles] Модель не найдена: %s\n", modelPath)
		return "", errors.New("Модель не найдена. Скачайте её в настройках.")
	}
	whisperPath := "./whisper-cli"
	outSRT := filePath + ".srt"
	_ = os.Remove(outSRT)

	if lang == "" {
		lang = "ru"
	}

	cmd := exec.Command(whisperPath, "-m", modelPath, "-f", filePath, "-otxt", "-osrt", "-l", lang)
	err := cmd.Run()
	if err != nil {
		log.Printf("[GenerateSubtitles] Ошибка запуска whisper-cli: %v\n", err)
		return "", err
	}

	srtData, err := os.ReadFile(outSRT)
	if err != nil {
		log.Printf("[GenerateSubtitles] Ошибка чтения SRT: %v\n", err)
		return "", err
	}
	log.Printf("[GenerateSubtitles] Субтитры успешно сгенерированы для файла: %s\n", filePath)
	return string(srtData), nil
}
