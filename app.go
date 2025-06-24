package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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
		localPath := filepath.Join("models", filepath.Base(m.Info.URL))
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

func (a *App) DownloadModel(ctx context.Context, name string) (string, error) {
	log.Printf("[DownloadModel] Запрошено скачивание модели: %s\n", name)
	info, ok := whisperModels[name]
	if !ok {
		log.Printf("[DownloadModel] Неизвестная модель: %s\n", name)
		return "", errors.New("unknown model")
	}
	os.MkdirAll("models", 0755)
	localPath := filepath.Join("models", filepath.Base(info.URL))
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
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		log.Printf("[DownloadModel] Ошибка копирования: %v\n", err)
		return "", err
	}
	log.Printf("[DownloadModel] Модель %s успешно скачана\n", name)
	return localPath, nil
}

func (a *App) GenerateSubtitles(ctx context.Context, filePath string, lang string, modelName string) (string, error) {
	log.Printf("[GenerateSubtitles] Генерация субтитров: файл=%s, язык=%s, модель=%s\n", filePath, lang, modelName)
	info, ok := whisperModels[modelName]
	if !ok {
		log.Printf("[GenerateSubtitles] Неизвестная модель: %s\n", modelName)
		return "", errors.New("unknown model")
	}
	modelPath := filepath.Join("models", filepath.Base(info.URL))
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
