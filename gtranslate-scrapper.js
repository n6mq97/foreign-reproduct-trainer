(function() {
    // 1. Укажите нужный заголовок
    const title = "Креповые финские носки 6 (конец)";

    const containers = document.querySelectorAll('div[data-alternative-index="0"]');
    
    const sentences = Array.from(containers).map(container => {
        const enElem = container.querySelector('[lang="en"]');
        const ruElem = container.querySelector('[lang="ru"]');
        
        // Проверяем, нашли ли мы элементы, прежде чем красить родителя
        if (enElem || ruElem) {
            // Ищем ближайший родительский элемент с атрибутом jscontroller
            const controllerParent = container.closest('[jscontroller]');
            if (controllerParent) {
                controllerParent.style.backgroundColor = 'red';
            }
        }

        return {
            "ru": ruElem ? ruElem.textContent.trim() : "",
            "en": enElem ? enElem.textContent.trim() : ""
        };
    });

    const finalData = {
        "title": title,
        "sentences": sentences
    };

    // Вывод и копирование
    const jsonResult = JSON.stringify(finalData, null, 2);
    console.log(jsonResult);
    
    if (typeof copy === 'function') {
        copy(jsonResult);
        console.log("JSON скопирован в буфер обмена.");
    }

    console.log(`Обработано элементов: ${sentences.length}`);
})();