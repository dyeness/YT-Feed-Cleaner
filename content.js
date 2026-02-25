function hideJams() {
    // 1. Поиск по URL: автогенерируемые джемы всегда содержат параметр list=RD
    const jamLinks = document.querySelectorAll('a[href*="list=RD"]');
    
    jamLinks.forEach(link => {
        // Находим родительскую карточку видео на главной странице или в боковой панели
        const card = link.closest('ytd-rich-item-renderer, ytd-compact-radio-renderer, ytd-radio-renderer, ytd-video-renderer');
        if (card && card.style.display !== 'none') {
            card.style.display = 'none';
        }
    });

    // 2. Дополнительная проверка по наличию текстового бейджа "Джем" (как на вашем скриншоте)
    // Это страховка на случай, если YouTube изменит структуру ссылок
    const badges = document.querySelectorAll('#text, span, div');
    badges.forEach(badge => {
        const text = badge.textContent.trim().toLowerCase();
        if (text === 'джем' || text === 'мой джем' || text === 'mix') {
            const card = badge.closest('ytd-rich-item-renderer, ytd-compact-radio-renderer, ytd-radio-renderer, ytd-video-renderer');
            if (card && card.style.display !== 'none') {
                card.style.display = 'none';
            }
        }
    });
}

// Настраиваем MutationObserver для динамически подгружаемого контента (при скролле страницы)
const observer = new MutationObserver(() => {
    hideJams();
});

// Запускаем отслеживание изменений на всей странице
observer.observe(document.documentElement, { 
    childList: true, 
    subtree: true 
});

// Выполняем первичную очистку при загрузке скрипта
hideJams();
