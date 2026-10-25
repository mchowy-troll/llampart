import type { InterfaceLanguage, TranslationDictionary } from '$lib/i18n/types';

export const FROSTED_GLASS_TRANSLATIONS: Record<InterfaceLanguage, TranslationDictionary> = {
	en: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Wallpaper',
			frostedGlassWallpaperDescription:
				'Choose one of 5 built-in wallpapers or a custom wallpaper stored locally in this browser.',
			frostedGlassMilkiness: 'Glass milkiness',
			frostedGlassOpaque: 'Disable transparency',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'User wallpaper',
			frostedGlassWallpaperUpload: 'Upload JPG/PNG',
			frostedGlassWallpaperAdd: 'Add',
			frostedGlassWallpaperReplace: 'Replace',
			frostedGlassWallpaperRemove: 'Remove',
			frostedGlassWallpaperUserSaved: 'User wallpaper saved.',
			frostedGlassWallpaperSaveError:
				'Could not save the wallpaper. The previous custom image may have been removed. Other changes have not been saved. Upload the image again and retry.',
			frostedGlassWallpaperUserRemoved: 'User wallpaper removed.',
			frostedGlassWallpaperUploadInvalidType: 'Choose a JPG or PNG file.',
			frostedGlassWallpaperUploadTooLarge: 'Wallpaper file can be up to 1.5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Use a JPG or PNG file up to 1.5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Could not save the wallpaper. Browser localStorage may be full.',
			info: {
				frostedGlassWallpaper:
					"Selected Frosted Glass wallpaper. Built-in wallpapers are shipped with llampart; custom wallpaper data is stored only in this browser's localStorage.",
				frostedGlassMilkiness: 'Adjust glass surfaces. 50% preserves the original material.',
				frostedGlassOpaque: 'Use opaque accent-tinted surfaces and remember the glass milkiness.'
			}
		}
	},
	pl: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Tapeta',
			frostedGlassWallpaperDescription:
				'Wybierz jedną z 5 wbudowanych tapet albo własną tapetę zapisaną lokalnie w tej przeglądarce.',
			frostedGlassMilkiness: 'Mleczność szkła',
			frostedGlassOpaque: 'Wyłącz przezroczystość',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Tapeta użytkownika',
			frostedGlassWallpaperUpload: 'Wczytaj JPG/PNG',
			frostedGlassWallpaperAdd: 'Dodaj',
			frostedGlassWallpaperReplace: 'Zmień',
			frostedGlassWallpaperRemove: 'Usuń',
			frostedGlassWallpaperUserSaved: 'Tapeta użytkownika została zapisana.',
			frostedGlassWallpaperSaveError:
				'Nie udało się zapisać tapety. Poprzedni własny obraz mógł zostać usunięty. Pozostałe zmiany nie zostały zapisane. Wczytaj obraz ponownie i ponów zapis.',
			frostedGlassWallpaperUserRemoved: 'Tapeta użytkownika została usunięta.',
			frostedGlassWallpaperUploadInvalidType: 'Wybierz plik JPG lub PNG.',
			frostedGlassWallpaperUploadTooLarge: 'Tapeta może mieć maksymalnie 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Użyj pliku JPG lub PNG o rozmiarze do 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Nie udało się zapisać tapety. LocalStorage przeglądarki może być pełny.',
			info: {
				frostedGlassWallpaper:
					'Wybrana tapeta Frosted Glass. Wbudowane tapety są dostarczane z llampart; własna tapeta jest zapisana tylko w localStorage tej przeglądarki.',
				frostedGlassMilkiness: 'Reguluje powierzchnie szkła. 50% zachowuje dotychczasowy materiał.',
				frostedGlassOpaque:
					'Nieprzezroczyste powierzchnie z akcentowym zabarwieniem. Zachowuje poziom mleczności.'
			}
		}
	},
	de: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Hintergrundbild',
			frostedGlassWallpaperDescription:
				'Wählen Sie eines von 5 integrierten Hintergrundbildern oder ein eigenes Hintergrundbild, das lokal in diesem Browser gespeichert wird.',
			frostedGlassMilkiness: 'Milchigkeit des Glases',
			frostedGlassOpaque: 'Transparenz deaktivieren',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Eigenes Hintergrundbild',
			frostedGlassWallpaperUpload: 'JPG/PNG hochladen',
			frostedGlassWallpaperAdd: 'Hinzufügen',
			frostedGlassWallpaperReplace: 'Ersetzen',
			frostedGlassWallpaperRemove: 'Entfernen',
			frostedGlassWallpaperUserSaved: 'Eigenes Hintergrundbild gespeichert.',
			frostedGlassWallpaperSaveError:
				'Das Hintergrundbild konnte nicht gespeichert werden. Das vorherige eigene Bild wurde möglicherweise entfernt. Andere Änderungen wurden nicht gespeichert. Lade das Bild erneut hoch und versuche es noch einmal.',
			frostedGlassWallpaperUserRemoved: 'Eigenes Hintergrundbild entfernt.',
			frostedGlassWallpaperUploadInvalidType: 'Wählen Sie eine JPG- oder PNG-Datei.',
			frostedGlassWallpaperUploadTooLarge: 'Das Hintergrundbild darf höchstens 1,5 MiB groß sein.',
			frostedGlassWallpaperUploadRequirements: 'Zulässig sind JPG- oder PNG-Dateien bis 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Das Hintergrundbild konnte nicht gespeichert werden. Der localStorage des Browsers ist möglicherweise voll.',
			info: {
				frostedGlassWallpaper:
					'Ausgewähltes Frosted-Glass-Hintergrundbild. Integrierte Hintergrundbilder werden mit llampart ausgeliefert; eigene Hintergrunddaten werden nur im localStorage dieses Browsers gespeichert.',
				frostedGlassMilkiness: 'Regelt Glasflächen. 50% bewahrt das ursprüngliche Material.',
				frostedGlassOpaque:
					'Undurchsichtige, akzentfarbige Flächen. Die Milchigkeit bleibt gespeichert.'
			}
		}
	},
	fr: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Fond d’écran',
			frostedGlassWallpaperDescription:
				'Choisissez l’un des 5 fonds intégrés ou un fond personnalisé enregistré localement dans ce navigateur.',
			frostedGlassMilkiness: 'Opalescence du verre',
			frostedGlassOpaque: 'Désactiver la transparence',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Fond utilisateur',
			frostedGlassWallpaperUpload: 'Importer JPG/PNG',
			frostedGlassWallpaperAdd: 'Ajouter',
			frostedGlassWallpaperReplace: 'Remplacer',
			frostedGlassWallpaperRemove: 'Supprimer',
			frostedGlassWallpaperUserSaved: 'Fond utilisateur enregistré.',
			frostedGlassWallpaperSaveError:
				'Impossible d’enregistrer le fond. L’image personnalisée précédente a peut-être été supprimée. Les autres modifications n’ont pas été enregistrées. Chargez à nouveau l’image et réessayez.',
			frostedGlassWallpaperUserRemoved: 'Fond utilisateur supprimé.',
			frostedGlassWallpaperUploadInvalidType: 'Choisissez un fichier JPG ou PNG.',
			frostedGlassWallpaperUploadTooLarge: 'Le fond peut faire au maximum 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Utilisez un fichier JPG ou PNG de 1,5 MiB maximum.',
			frostedGlassWallpaperUploadReadError:
				'Impossible d’enregistrer le fond. Le localStorage du navigateur est peut-être plein.',
			info: {
				frostedGlassWallpaper:
					'Fond d’écran Frosted Glass sélectionné. Les fonds intégrés sont fournis avec llampart ; le fond personnalisé est stocké uniquement dans le localStorage de ce navigateur.',
				frostedGlassMilkiness: 'Règle les surfaces vitrées. 50% conserve le matériau original.',
				frostedGlassOpaque:
					'Surfaces opaques teintées de la couleur d’accent. L’opalescence est mémorisée.'
			}
		}
	},
	it: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Sfondo',
			frostedGlassWallpaperDescription:
				'Scegli uno dei 5 sfondi integrati o uno sfondo personalizzato salvato localmente in questo browser.',
			frostedGlassMilkiness: 'Opacità lattiginosa del vetro',
			frostedGlassOpaque: 'Disattiva trasparenza',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Sfondo utente',
			frostedGlassWallpaperUpload: 'Carica JPG/PNG',
			frostedGlassWallpaperAdd: 'Aggiungi',
			frostedGlassWallpaperReplace: 'Sostituisci',
			frostedGlassWallpaperRemove: 'Rimuovi',
			frostedGlassWallpaperUserSaved: 'Sfondo utente salvato.',
			frostedGlassWallpaperSaveError:
				'Impossibile salvare lo sfondo. L’immagine personalizzata precedente potrebbe essere stata rimossa. Le altre modifiche non sono state salvate. Carica nuovamente l’immagine e riprova.',
			frostedGlassWallpaperUserRemoved: 'Sfondo utente rimosso.',
			frostedGlassWallpaperUploadInvalidType: 'Scegli un file JPG o PNG.',
			frostedGlassWallpaperUploadTooLarge: 'Lo sfondo può essere al massimo di 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Usa un file JPG o PNG fino a 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Impossibile salvare lo sfondo. Il localStorage del browser potrebbe essere pieno.',
			info: {
				frostedGlassWallpaper:
					'Sfondo Frosted Glass selezionato. Gli sfondi integrati sono inclusi con llampart; lo sfondo personalizzato viene salvato solo nel localStorage di questo browser.',
				frostedGlassMilkiness: 'Regola le superfici in vetro. 50% conserva il materiale originale.',
				frostedGlassOpaque:
					'Superfici opache colorate con l’accento. Il livello lattiginoso viene ricordato.'
			}
		}
	},
	es: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Fondo de pantalla',
			frostedGlassWallpaperDescription:
				'Elige uno de los 5 fondos integrados o un fondo personalizado guardado localmente en este navegador.',
			frostedGlassMilkiness: 'Opacidad lechosa del cristal',
			frostedGlassOpaque: 'Desactivar transparencia',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Fondo del usuario',
			frostedGlassWallpaperUpload: 'Subir JPG/PNG',
			frostedGlassWallpaperAdd: 'Añadir',
			frostedGlassWallpaperReplace: 'Cambiar',
			frostedGlassWallpaperRemove: 'Eliminar',
			frostedGlassWallpaperUserSaved: 'Fondo del usuario guardado.',
			frostedGlassWallpaperSaveError:
				'No se pudo guardar el fondo. Es posible que se haya eliminado la imagen personalizada anterior. Los demás cambios no se han guardado. Vuelve a cargar la imagen e inténtalo de nuevo.',
			frostedGlassWallpaperUserRemoved: 'Fondo del usuario eliminado.',
			frostedGlassWallpaperUploadInvalidType: 'Elige un archivo JPG o PNG.',
			frostedGlassWallpaperUploadTooLarge: 'El fondo puede tener como máximo 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Usa un archivo JPG o PNG de hasta 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'No se pudo guardar el fondo. Es posible que el localStorage del navegador esté lleno.',
			info: {
				frostedGlassWallpaper:
					'Fondo Frosted Glass seleccionado. Los fondos integrados se incluyen con llampart; el fondo personalizado se guarda solo en el localStorage de este navegador.',
				frostedGlassMilkiness:
					'Ajusta las superficies de cristal. 50% conserva el material original.',
				frostedGlassOpaque:
					'Superficies opacas teñidas con el acento. Se recuerda el nivel lechoso.'
			}
		}
	},
	pt: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Imagem de fundo',
			frostedGlassWallpaperDescription:
				'Escolha uma das 5 imagens de fundo integradas ou uma imagem personalizada guardada localmente neste navegador.',
			frostedGlassMilkiness: 'Efeito leitoso do vidro',
			frostedGlassOpaque: 'Desativar transparência',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Imagem de fundo personalizada',
			frostedGlassWallpaperUpload: 'Enviar JPG/PNG',
			frostedGlassWallpaperAdd: 'Adicionar',
			frostedGlassWallpaperReplace: 'Substituir',
			frostedGlassWallpaperRemove: 'Remover',
			frostedGlassWallpaperUserSaved: 'Imagem de fundo personalizada guardada.',
			frostedGlassWallpaperSaveError:
				'Não foi possível guardar a imagem de fundo. A imagem personalizada anterior pode ter sido removida. As restantes alterações não foram guardadas. Envie a imagem novamente e repita a operação.',
			frostedGlassWallpaperUserRemoved: 'Imagem de fundo personalizada removida.',
			frostedGlassWallpaperUploadInvalidType: 'Escolha um ficheiro JPG ou PNG.',
			frostedGlassWallpaperUploadTooLarge:
				'O ficheiro da imagem de fundo pode ter, no máximo, 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements:
				'Use um ficheiro JPG ou PNG com, no máximo, 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Não foi possível guardar a imagem de fundo. O localStorage do navegador pode estar cheio.',
			info: {
				frostedGlassWallpaper:
					'Imagem de fundo Frosted Glass selecionada. As imagens integradas são fornecidas com o llampart; os dados da imagem personalizada são guardados apenas no localStorage deste navegador.',
				frostedGlassMilkiness:
					'Ajuste as superfícies de vidro. O valor 50% preserva o material original.',
				frostedGlassOpaque:
					'Usar superfícies opacas tingidas com a cor de destaque, sem perder o nível definido para o efeito leitoso do vidro.'
			}
		}
	},
	et: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Taustapilt',
			frostedGlassWallpaperDescription:
				'Vali üks viiest sisseehitatud taustapildist või oma taustapilt, mis salvestatakse kohalikult sellesse brauserisse.',
			frostedGlassMilkiness: 'Klaasi piimjas hägusus',
			frostedGlassOpaque: 'Keela läbipaistvus',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Kasutaja taustapilt',
			frostedGlassWallpaperUpload: 'Laadi üles JPG/PNG',
			frostedGlassWallpaperAdd: 'Lisa',
			frostedGlassWallpaperReplace: 'Asenda',
			frostedGlassWallpaperRemove: 'Eemalda',
			frostedGlassWallpaperUserSaved: 'Kasutaja taustapilt salvestati.',
			frostedGlassWallpaperSaveError:
				'Taustapilti ei saanud salvestada. Eelmine kohandatud pilt võis olla eemaldatud. Muid muudatusi pole salvestatud. Laadi pilt uuesti üles ja proovi uuesti.',
			frostedGlassWallpaperUserRemoved: 'Kasutaja taustapilt eemaldati.',
			frostedGlassWallpaperUploadInvalidType: 'Vali JPG- või PNG-fail.',
			frostedGlassWallpaperUploadTooLarge: 'Taustapildifail võib olla kuni 1,5 MiB suurune.',
			frostedGlassWallpaperUploadRequirements: 'Kasuta kuni 1,5 MiB suurust JPG- või PNG-faili.',
			frostedGlassWallpaperUploadReadError:
				'Taustapilti ei saanud salvestada. Brauseri localStorage võib olla täis.',
			info: {
				frostedGlassWallpaper:
					'Valitud Frosted Glass taustapilt. Sisseehitatud taustapildid on llampartiga kaasas; kohandatud taustapildi andmed salvestatakse ainult selle brauseri localStorage’i.',
				frostedGlassMilkiness: 'Kohanda klaaspindu. Väärtus 50% säilitab algse materjali.',
				frostedGlassOpaque:
					'Kasuta läbipaistmatuid rõhuvärviga toonitud pindu ja säilita klaasi piimja hägususe seade.'
			}
		}
	},
	nl: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Achtergrond',
			frostedGlassWallpaperDescription:
				'Kies een van de 5 ingebouwde achtergronden of een eigen achtergrond die lokaal in deze browser wordt opgeslagen.',
			frostedGlassMilkiness: 'Melkachtigheid van het glas',
			frostedGlassOpaque: 'Transparantie uitschakelen',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Eigen achtergrond',
			frostedGlassWallpaperUpload: 'JPG/PNG uploaden',
			frostedGlassWallpaperAdd: 'Toevoegen',
			frostedGlassWallpaperReplace: 'Vervangen',
			frostedGlassWallpaperRemove: 'Verwijderen',
			frostedGlassWallpaperUserSaved: 'Eigen achtergrond opgeslagen.',
			frostedGlassWallpaperSaveError:
				'De achtergrond kon niet worden opgeslagen. De vorige eigen afbeelding is mogelijk verwijderd. Andere wijzigingen zijn niet opgeslagen. Upload de afbeelding opnieuw en probeer het nogmaals.',
			frostedGlassWallpaperUserRemoved: 'Eigen achtergrond verwijderd.',
			frostedGlassWallpaperUploadInvalidType: 'Kies een JPG- of PNG-bestand.',
			frostedGlassWallpaperUploadTooLarge:
				'Het achtergrondbestand mag maximaal 1,5 MiB groot zijn.',
			frostedGlassWallpaperUploadRequirements:
				'Gebruik een JPG- of PNG-bestand van maximaal 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'De achtergrond kon niet worden opgeslagen. De localStorage van de browser is mogelijk vol.',
			info: {
				frostedGlassWallpaper:
					'Geselecteerde Frosted Glass-achtergrond. Ingebouwde achtergronden worden meegeleverd met llampart; gegevens van eigen achtergronden worden alleen opgeslagen in de localStorage van deze browser.',
				frostedGlassMilkiness:
					'Pas de glasoppervlakken aan. Bij 50% blijft het oorspronkelijke materiaal behouden.',
				frostedGlassOpaque:
					'Gebruik ondoorzichtige oppervlakken met de accentkleur en bewaar de ingestelde melkachtigheid van het glas.'
			}
		}
	},
	fi: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Taustakuva',
			frostedGlassWallpaperDescription:
				'Valitse yksi viidestä sisäänrakennetusta taustakuvasta tai oma taustakuva, joka tallennetaan paikallisesti tähän selaimeen.',
			frostedGlassMilkiness: 'Lasin maitomaisuus',
			frostedGlassOpaque: 'Poista läpinäkyvyys käytöstä',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Oma taustakuva',
			frostedGlassWallpaperUpload: 'Lataa JPG/PNG',
			frostedGlassWallpaperAdd: 'Lisää',
			frostedGlassWallpaperReplace: 'Vaihda',
			frostedGlassWallpaperRemove: 'Poista',
			frostedGlassWallpaperUserSaved: 'Oma taustakuva tallennettu.',
			frostedGlassWallpaperSaveError:
				'Taustakuvaa ei voitu tallentaa. Aiempi oma kuva on saatettu poistaa. Muita muutoksia ei ole tallennettu. Lataa kuva uudelleen ja yritä vielä kerran.',
			frostedGlassWallpaperUserRemoved: 'Oma taustakuva poistettu.',
			frostedGlassWallpaperUploadInvalidType: 'Valitse JPG- tai PNG-tiedosto.',
			frostedGlassWallpaperUploadTooLarge: 'Taustakuvatiedoston enimmäiskoko on 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Käytä enintään 1,5 MiB:n JPG- tai PNG-tiedostoa.',
			frostedGlassWallpaperUploadReadError:
				'Taustakuvaa ei voitu tallentaa. Selaimen localStorage-tallennustila saattaa olla täynnä.',
			info: {
				frostedGlassWallpaper:
					'Valittu Frosted Glass -taustakuva. Sisäänrakennetut taustakuvat toimitetaan llampartin mukana. Oman taustakuvan tiedot tallennetaan vain tämän selaimen localStorage-tallennustilaan.',
				frostedGlassMilkiness: 'Säädä lasipintoja. 50 % säilyttää alkuperäisen materiaalin.',
				frostedGlassOpaque:
					'Käytä läpinäkymättömiä, korostusvärillä sävytettyjä pintoja ja säilytä lasin maitomaisuuden asetus.'
			}
		}
	},
	sk: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Tapeta',
			frostedGlassWallpaperDescription:
				'Vyberte jednu z 5 vstavaných tapiet alebo vlastnú tapetu uloženú lokálne v tomto prehliadači.',
			frostedGlassMilkiness: 'Mliečnosť skla',
			frostedGlassOpaque: 'Vypnúť priehľadnosť',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Vlastná tapeta',
			frostedGlassWallpaperUpload: 'Nahrať JPG/PNG',
			frostedGlassWallpaperAdd: 'Pridať',
			frostedGlassWallpaperReplace: 'Nahradiť',
			frostedGlassWallpaperRemove: 'Odstrániť',
			frostedGlassWallpaperUserSaved: 'Vlastná tapeta bola uložená.',
			frostedGlassWallpaperSaveError:
				'Tapetu sa nepodarilo uložiť. Predchádzajúci vlastný obrázok mohol byť odstránený. Ostatné zmeny sa neuložili. Nahrajte obrázok znova a zopakujte uloženie.',
			frostedGlassWallpaperUserRemoved: 'Vlastná tapeta bola odstránená.',
			frostedGlassWallpaperUploadInvalidType: 'Vyberte súbor JPG alebo PNG.',
			frostedGlassWallpaperUploadTooLarge: 'Súbor tapety môže mať najviac 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Použite súbor JPG alebo PNG do 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Tapetu sa nepodarilo uložiť. Úložisko localStorage prehliadača môže byť plné.',
			info: {
				frostedGlassWallpaper:
					'Vybraná tapeta Frosted Glass. Vstavané tapety sú súčasťou llampart. Údaje vlastnej tapety sa ukladajú iba do localStorage tohto prehliadača.',
				frostedGlassMilkiness: 'Upravuje sklenené plochy. Hodnota 50 % zachová pôvodný materiál.',
				frostedGlassOpaque:
					'Použiť nepriehľadné plochy zafarbené farbou zvýraznenia a zapamätať si nastavenú mliečnosť skla.'
			}
		}
	},
	cs: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Tapeta',
			frostedGlassWallpaperDescription:
				'Vyberte jednu z 5 vestavěných tapet nebo vlastní tapetu uloženou místně v tomto prohlížeči.',
			frostedGlassMilkiness: 'Mléčnost skla',
			frostedGlassOpaque: 'Vypnout průhlednost',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Vlastní tapeta',
			frostedGlassWallpaperUpload: 'Nahrát JPG/PNG',
			frostedGlassWallpaperAdd: 'Přidat',
			frostedGlassWallpaperReplace: 'Nahradit',
			frostedGlassWallpaperRemove: 'Odebrat',
			frostedGlassWallpaperUserSaved: 'Vlastní tapeta byla uložena.',
			frostedGlassWallpaperSaveError:
				'Tapetu se nepodařilo uložit. Předchozí vlastní obrázek mohl být odstraněn. Ostatní změny nebyly uloženy. Nahrajte obrázek znovu a zopakujte uložení.',
			frostedGlassWallpaperUserRemoved: 'Vlastní tapeta byla odebrána.',
			frostedGlassWallpaperUploadInvalidType: 'Vyberte soubor JPG nebo PNG.',
			frostedGlassWallpaperUploadTooLarge: 'Soubor tapety může mít nejvýše 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements:
				'Použijte soubor JPG nebo PNG o velikosti do 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Tapetu se nepodařilo uložit. Úložiště localStorage prohlížeče může být plné.',
			info: {
				frostedGlassWallpaper:
					'Vybraná tapeta Frosted Glass. Vestavěné tapety jsou součástí llampart; data vlastní tapety se ukládají pouze do localStorage tohoto prohlížeče.',
				frostedGlassMilkiness:
					'Upravuje vzhled skleněných ploch. Hodnota 50 % zachovává původní materiál.',
				frostedGlassOpaque:
					'Používat neprůhledné plochy zabarvené zvýrazňovací barvou a zapamatovat si nastavení mléčnosti skla.'
			}
		}
	},
	ro: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Imagine de fundal',
			frostedGlassWallpaperDescription:
				'Alege una dintre cele 5 imagini de fundal integrate sau o imagine personalizată stocată local în acest browser.',
			frostedGlassMilkiness: 'Aspectul lăptos al sticlei',
			frostedGlassOpaque: 'Dezactivează transparența',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Imagine de fundal personalizată',
			frostedGlassWallpaperUpload: 'Încarcă JPG/PNG',
			frostedGlassWallpaperAdd: 'Adaugă',
			frostedGlassWallpaperReplace: 'Înlocuiește',
			frostedGlassWallpaperRemove: 'Elimină',
			frostedGlassWallpaperUserSaved: 'Imaginea de fundal personalizată a fost salvată.',
			frostedGlassWallpaperSaveError:
				'Imaginea de fundal nu a putut fi salvată. Este posibil ca imaginea personalizată anterioară să fi fost eliminată. Celelalte modificări nu au fost salvate. Încarcă din nou imaginea și reîncearcă.',
			frostedGlassWallpaperUserRemoved: 'Imaginea de fundal personalizată a fost eliminată.',
			frostedGlassWallpaperUploadInvalidType: 'Alege un fișier JPG sau PNG.',
			frostedGlassWallpaperUploadTooLarge:
				'Fișierul imaginii de fundal poate avea cel mult 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements:
				'Folosește un fișier JPG sau PNG de cel mult 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Imaginea de fundal nu a putut fi salvată. Este posibil ca spațiul localStorage al browserului să fie plin.',
			info: {
				frostedGlassWallpaper:
					'Imaginea de fundal Frosted Glass selectată. Imaginile integrate sunt incluse în llampart; datele imaginii personalizate sunt stocate doar în localStorage al acestui browser.',
				frostedGlassMilkiness:
					'Ajustează suprafețele din sticlă. Valoarea de 50% păstrează materialul original.',
				frostedGlassOpaque:
					'Folosește suprafețe opace în nuanța culorii de accent și păstrează setarea aspectului lăptos al sticlei.'
			}
		}
	},
	lv: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Fona attēls',
			frostedGlassWallpaperDescription:
				'Izvēlieties vienu no 5 iebūvētajiem fona attēliem vai pielāgotu fona attēlu, kas tiek glabāts lokāli šajā pārlūkā.',
			frostedGlassMilkiness: 'Stikla pienainums',
			frostedGlassOpaque: 'Atspējot caurspīdīgumu',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Lietotāja fona attēls',
			frostedGlassWallpaperUpload: 'Augšupielādēt JPG/PNG',
			frostedGlassWallpaperAdd: 'Pievienot',
			frostedGlassWallpaperReplace: 'Aizstāt',
			frostedGlassWallpaperRemove: 'Noņemt',
			frostedGlassWallpaperUserSaved: 'Lietotāja fona attēls saglabāts.',
			frostedGlassWallpaperSaveError:
				'Neizdevās saglabāt fona attēlu. Iepriekšējais pielāgotais attēls, iespējams, ir noņemts. Citas izmaiņas nav saglabātas. Augšupielādējiet attēlu vēlreiz un atkārtojiet saglabāšanu.',
			frostedGlassWallpaperUserRemoved: 'Lietotāja fona attēls noņemts.',
			frostedGlassWallpaperUploadInvalidType: 'Izvēlieties JPG vai PNG failu.',
			frostedGlassWallpaperUploadTooLarge: 'Fona attēla fails nedrīkst pārsniegt 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements:
				'Izmantojiet JPG vai PNG failu, kas nepārsniedz 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Neizdevās saglabāt fona attēlu. Iespējams, pārlūka localStorage ir pilns.',
			info: {
				frostedGlassWallpaper:
					'Izvēlētais Frosted Glass fona attēls. Iebūvētie fona attēli tiek piegādāti kopā ar llampart; pielāgotā fona attēla dati tiek glabāti tikai šī pārlūka localStorage.',
				frostedGlassMilkiness:
					'Pielāgo stikla virsmas. Vērtība 50% saglabā sākotnējo materiāla izskatu.',
				frostedGlassOpaque:
					'Izmantot necaurspīdīgas virsmas akcenta krāsas tonī un saglabāt stikla pienainuma iestatījumu.'
			}
		}
	},
	el: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Ταπετσαρία',
			frostedGlassWallpaperDescription:
				'Επιλέξτε μία από τις 5 ενσωματωμένες ταπετσαρίες ή μια προσαρμοσμένη ταπετσαρία που αποθηκεύεται τοπικά σε αυτό το πρόγραμμα περιήγησης.',
			frostedGlassMilkiness: 'Γαλακτώδης όψη γυαλιού',
			frostedGlassOpaque: 'Απενεργοποίηση διαφάνειας',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Ταπετσαρία χρήστη',
			frostedGlassWallpaperUpload: 'Μεταφόρτωση JPG/PNG',
			frostedGlassWallpaperAdd: 'Προσθήκη',
			frostedGlassWallpaperReplace: 'Αντικατάσταση',
			frostedGlassWallpaperRemove: 'Αφαίρεση',
			frostedGlassWallpaperUserSaved: 'Η ταπετσαρία χρήστη αποθηκεύτηκε.',
			frostedGlassWallpaperSaveError:
				'Δεν ήταν δυνατή η αποθήκευση της ταπετσαρίας. Η προηγούμενη προσαρμοσμένη εικόνα ενδέχεται να έχει αφαιρεθεί. Οι υπόλοιπες αλλαγές δεν έχουν αποθηκευτεί. Ανεβάστε ξανά την εικόνα και δοκιμάστε πάλι.',
			frostedGlassWallpaperUserRemoved: 'Η ταπετσαρία χρήστη αφαιρέθηκε.',
			frostedGlassWallpaperUploadInvalidType: 'Επιλέξτε αρχείο JPG ή PNG.',
			frostedGlassWallpaperUploadTooLarge: 'Το αρχείο ταπετσαρίας μπορεί να είναι έως 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Χρησιμοποιήστε αρχείο JPG ή PNG έως 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Δεν ήταν δυνατή η αποθήκευση της ταπετσαρίας. Το localStorage του προγράμματος περιήγησης ενδέχεται να είναι γεμάτο.',
			info: {
				frostedGlassWallpaper:
					'Η επιλεγμένη ταπετσαρία Frosted Glass. Οι ενσωματωμένες ταπετσαρίες παρέχονται μαζί με το llampart· τα δεδομένα της προσαρμοσμένης ταπετσαρίας αποθηκεύονται μόνο στο localStorage αυτού του προγράμματος περιήγησης.',
				frostedGlassMilkiness:
					'Ρυθμίζει την όψη των γυάλινων επιφανειών. Η τιμή 50% διατηρεί το αρχικό υλικό.',
				frostedGlassOpaque:
					'Χρήση αδιαφανών επιφανειών με απόχρωση του χρώματος έμφασης και διατήρηση της ρύθμισης γαλακτώδους όψης του γυαλιού.'
			}
		}
	},
	da: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Baggrundsbillede',
			frostedGlassWallpaperDescription:
				'Vælg et af de 5 indbyggede baggrundsbilleder eller dit eget baggrundsbillede, som gemmes lokalt i denne browser.',
			frostedGlassMilkiness: 'Mælkehvid glaseffekt',
			frostedGlassOpaque: 'Deaktivér gennemsigtighed',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Eget baggrundsbillede',
			frostedGlassWallpaperUpload: 'Upload JPG/PNG',
			frostedGlassWallpaperAdd: 'Tilføj',
			frostedGlassWallpaperReplace: 'Erstat',
			frostedGlassWallpaperRemove: 'Fjern',
			frostedGlassWallpaperUserSaved: 'Dit baggrundsbillede er gemt.',
			frostedGlassWallpaperSaveError:
				'Baggrundsbilledet kunne ikke gemmes. Det tidligere brugerdefinerede billede kan være blevet fjernet. Andre ændringer er ikke gemt. Upload billedet igen, og prøv igen.',
			frostedGlassWallpaperUserRemoved: 'Dit baggrundsbillede er fjernet.',
			frostedGlassWallpaperUploadInvalidType: 'Vælg en JPG- eller PNG-fil.',
			frostedGlassWallpaperUploadTooLarge: 'Baggrundsbilledet må højst fylde 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Brug en JPG- eller PNG-fil på højst 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Baggrundsbilledet kunne ikke gemmes. Browserens localStorage kan være fuld.',
			info: {
				frostedGlassWallpaper:
					'Det valgte Frosted Glass-baggrundsbillede. Indbyggede baggrundsbilleder leveres med llampart. Data for dit eget baggrundsbillede gemmes kun i denne browsers localStorage.',
				frostedGlassMilkiness: 'Justér glasfladerne. 50% bevarer det oprindelige materiale.',
				frostedGlassOpaque:
					'Brug uigennemsigtige flader tonet med accentfarven, og bevar indstillingen for den mælkehvide glaseffekt.'
			}
		}
	},
	sv: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Bakgrundsbild',
			frostedGlassWallpaperDescription:
				'Välj en av 5 inbyggda bakgrundsbilder eller en egen bakgrundsbild som lagras lokalt i den här webbläsaren.',
			frostedGlassMilkiness: 'Glasets mjölkighet',
			frostedGlassOpaque: 'Inaktivera transparens',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Egen bakgrundsbild',
			frostedGlassWallpaperUpload: 'Ladda upp JPG/PNG',
			frostedGlassWallpaperAdd: 'Lägg till',
			frostedGlassWallpaperReplace: 'Ersätt',
			frostedGlassWallpaperRemove: 'Ta bort',
			frostedGlassWallpaperUserSaved: 'Den egna bakgrundsbilden har sparats.',
			frostedGlassWallpaperSaveError:
				'Det gick inte att spara bakgrundsbilden. Den tidigare egna bilden kan ha tagits bort. Övriga ändringar har inte sparats. Ladda upp bilden igen och försök på nytt.',
			frostedGlassWallpaperUserRemoved: 'Den egna bakgrundsbilden har tagits bort.',
			frostedGlassWallpaperUploadInvalidType: 'Välj en JPG- eller PNG-fil.',
			frostedGlassWallpaperUploadTooLarge: 'Bakgrundsbildens fil får vara högst 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Använd en JPG- eller PNG-fil på högst 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Det gick inte att spara bakgrundsbilden. Webbläsarens localStorage kan vara fullt.',
			info: {
				frostedGlassWallpaper:
					'Vald bakgrundsbild för Frosted Glass. Inbyggda bakgrundsbilder följer med llampart. Egna bakgrundsbilder lagras bara i den här webbläsarens localStorage.',
				frostedGlassMilkiness: 'Justera glasytorna. 50 % bevarar det ursprungliga materialet.',
				frostedGlassOpaque:
					'Använd ogenomskinliga ytor tonade i accentfärgen och behåll inställningen för glasets mjölkighet.'
			}
		}
	},
	ga: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Cúlbhratán',
			frostedGlassWallpaperDescription:
				'Roghnaigh ceann de na 5 chúlbhratán ionsuite nó cúlbhratán saincheaptha a stóráiltear go háitiúil sa bhrabhsálaí seo.',
			frostedGlassMilkiness: 'Scamallacht na gloine',
			frostedGlassOpaque: 'Díchumasaigh trédhearcacht',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Cúlbhratán an úsáideora',
			frostedGlassWallpaperUpload: 'Uaslódáil JPG/PNG',
			frostedGlassWallpaperAdd: 'Cuir leis',
			frostedGlassWallpaperReplace: 'Ionadaigh',
			frostedGlassWallpaperRemove: 'Bain',
			frostedGlassWallpaperUserSaved: 'Sábháladh cúlbhratán an úsáideora.',
			frostedGlassWallpaperSaveError:
				'Níorbh fhéidir an cúlbhratán a shábháil. Seans gur baineadh an íomhá shaincheaptha roimhe seo. Níor sábháladh na hathruithe eile. Uaslódáil an íomhá arís agus bain triail eile as.',
			frostedGlassWallpaperUserRemoved: 'Baineadh cúlbhratán an úsáideora.',
			frostedGlassWallpaperUploadInvalidType: 'Roghnaigh comhad JPG nó PNG.',
			frostedGlassWallpaperUploadTooLarge:
				'Ní féidir le comhad an chúlbhratáin a bheith níos mó ná 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Úsáid comhad JPG nó PNG nach mó ná 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Níorbh fhéidir an cúlbhratán a shábháil. Seans go bhfuil localStorage an bhrabhsálaí lán.',
			info: {
				frostedGlassWallpaper:
					'An cúlbhratán Frosted Glass roghnaithe. Tagann cúlbhratáin ionsuite le llampart; ní stóráiltear sonraí an chúlbhratáin shaincheaptha ach in localStorage an bhrabhsálaí seo.',
				frostedGlassMilkiness:
					'Coigeartaigh na dromchlaí gloine. Coinníonn 50% an t-ábhar bunaidh.',
				frostedGlassOpaque:
					'Úsáid dromchlaí teimhneacha ar dhath an aicinn agus coinnigh leibhéal scamallachta na gloine i gcuimhne.'
			}
		}
	},
	hr: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Pozadinska slika',
			frostedGlassWallpaperDescription:
				'Odaberite jednu od 5 ugrađenih pozadinskih slika ili vlastitu sliku pohranjenu lokalno u ovom pregledniku.',
			frostedGlassMilkiness: 'Mliječnost stakla',
			frostedGlassOpaque: 'Onemogući prozirnost',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Korisnička pozadinska slika',
			frostedGlassWallpaperUpload: 'Prenesi JPG/PNG',
			frostedGlassWallpaperAdd: 'Dodaj',
			frostedGlassWallpaperReplace: 'Zamijeni',
			frostedGlassWallpaperRemove: 'Ukloni',
			frostedGlassWallpaperUserSaved: 'Korisnička pozadinska slika je spremljena.',
			frostedGlassWallpaperSaveError:
				'Nije moguće spremiti pozadinsku sliku. Prethodna vlastita slika možda je uklonjena. Ostale izmjene nisu spremljene. Ponovno prenesite sliku i pokušajte još jednom.',
			frostedGlassWallpaperUserRemoved: 'Korisnička pozadinska slika je uklonjena.',
			frostedGlassWallpaperUploadInvalidType: 'Odaberite datoteku JPG ili PNG.',
			frostedGlassWallpaperUploadTooLarge: 'Datoteka pozadinske slike može imati najviše 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements:
				'Koristite datoteku JPG ili PNG veličine do 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Nije moguće spremiti pozadinsku sliku. localStorage preglednika možda je pun.',
			info: {
				frostedGlassWallpaper:
					'Odabrana pozadinska slika teme Frosted Glass. Ugrađene pozadinske slike isporučuju se uz llampart; podaci vlastite pozadinske slike pohranjuju se samo u localStorage ovog preglednika.',
				frostedGlassMilkiness:
					'Prilagodite staklene površine. Vrijednost 50% zadržava izvorni materijal.',
				frostedGlassOpaque:
					'Koristi neprozirne površine obojene bojom naglaska i pamti razinu mliječnosti stakla.'
			}
		}
	},
	sl: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Ozadje',
			frostedGlassWallpaperDescription:
				'Izberite eno od 5 vgrajenih ozadij ali ozadje po meri, shranjeno lokalno v tem brskalniku.',
			frostedGlassMilkiness: 'Mlečnost stekla',
			frostedGlassOpaque: 'Onemogoči prosojnost',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Uporabniško ozadje',
			frostedGlassWallpaperUpload: 'Naloži JPG/PNG',
			frostedGlassWallpaperAdd: 'Dodaj',
			frostedGlassWallpaperReplace: 'Zamenjaj',
			frostedGlassWallpaperRemove: 'Odstrani',
			frostedGlassWallpaperUserSaved: 'Uporabniško ozadje je shranjeno.',
			frostedGlassWallpaperSaveError:
				'Ozadja ni bilo mogoče shraniti. Prejšnja slika po meri je bila morda odstranjena. Druge spremembe niso bile shranjene. Znova naložite sliko in poskusite še enkrat.',
			frostedGlassWallpaperUserRemoved: 'Uporabniško ozadje je odstranjeno.',
			frostedGlassWallpaperUploadInvalidType: 'Izberite datoteko JPG ali PNG.',
			frostedGlassWallpaperUploadTooLarge: 'Datoteka ozadja je lahko velika največ 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Uporabite datoteko JPG ali PNG do 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Ozadja ni bilo mogoče shraniti. Shramba localStorage v brskalniku je morda polna.',
			info: {
				frostedGlassWallpaper:
					'Izbrano ozadje Frosted Glass. Vgrajena ozadja so priložena aplikaciji llampart; podatki ozadja po meri so shranjeni samo v localStorage tega brskalnika.',
				frostedGlassMilkiness:
					'Prilagodite steklene površine. Vrednost 50 % ohrani izvirni material.',
				frostedGlassOpaque:
					'Uporabi neprosojne površine, obarvane z barvo poudarka, in si zapomni stopnjo mlečnosti stekla.'
			}
		}
	},
	lt: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Fono paveikslėlis',
			frostedGlassWallpaperDescription:
				'Pasirinkite vieną iš 5 integruotų fono paveikslėlių arba savo paveikslėlį, saugomą tik šioje naršyklėje.',
			frostedGlassMilkiness: 'Stiklo pieniškumas',
			frostedGlassOpaque: 'Išjungti skaidrumą',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Naudotojo fono paveikslėlis',
			frostedGlassWallpaperUpload: 'Įkelti JPG/PNG',
			frostedGlassWallpaperAdd: 'Pridėti',
			frostedGlassWallpaperReplace: 'Pakeisti',
			frostedGlassWallpaperRemove: 'Pašalinti',
			frostedGlassWallpaperUserSaved: 'Naudotojo fono paveikslėlis išsaugotas.',
			frostedGlassWallpaperSaveError:
				'Nepavyko išsaugoti fono paveikslėlio. Ankstesnis pasirinktinis paveikslėlis galėjo būti pašalintas. Kiti pakeitimai neišsaugoti. Įkelkite paveikslėlį iš naujo ir bandykite dar kartą.',
			frostedGlassWallpaperUserRemoved: 'Naudotojo fono paveikslėlis pašalintas.',
			frostedGlassWallpaperUploadInvalidType: 'Pasirinkite JPG arba PNG failą.',
			frostedGlassWallpaperUploadTooLarge:
				'Fono paveikslėlio failas gali būti ne didesnis kaip 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements:
				'Naudokite ne didesnį kaip 1,5 MiB JPG arba PNG failą.',
			frostedGlassWallpaperUploadReadError:
				'Nepavyko išsaugoti fono paveikslėlio. Naršyklės localStorage saugykla gali būti pilna.',
			info: {
				frostedGlassWallpaper:
					'Pasirinktas Frosted Glass fono paveikslėlis. Integruoti paveikslėliai pateikiami kartu su llampart; pasirinktinio paveikslėlio duomenys saugomi tik šios naršyklės localStorage saugykloje.',
				frostedGlassMilkiness:
					'Koreguokite stiklo paviršių išvaizdą. 50% išlaiko pradinę medžiagos išvaizdą.',
				frostedGlassOpaque:
					'Naudoti neskaidrius paviršius su akcentinės spalvos atspalviu ir išsaugoti stiklo pieniškumo nustatymą.'
			}
		}
	},
	mt: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Sfond',
			frostedGlassWallpaperDescription:
				'Agħżel wieħed mill-5 sfondi integrati jew sfond personalizzat maħżun lokalment f’dan il-brawżer.',
			frostedGlassMilkiness: 'Effett ħalibi tal-ħġieġ',
			frostedGlassOpaque: 'Itfi t-trasparenza',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Sfond tal-utent',
			frostedGlassWallpaperUpload: 'Tella’ JPG/PNG',
			frostedGlassWallpaperAdd: 'Żid',
			frostedGlassWallpaperReplace: 'Ibdel',
			frostedGlassWallpaperRemove: 'Neħħi',
			frostedGlassWallpaperUserSaved: 'L-isfond tal-utent ġie ssejvjat.',
			frostedGlassWallpaperSaveError:
				'L-isfond ma setax jiġi ssejvjat. L-immaġni personalizzata preċedenti setgħet tneħħiet. Il-bidliet l-oħra ma ġewx issejvjati. Erġa’ tella’ l-immaġni u erġa’ pprova.',
			frostedGlassWallpaperUserRemoved: 'L-isfond tal-utent tneħħa.',
			frostedGlassWallpaperUploadInvalidType: 'Agħżel fajl JPG jew PNG.',
			frostedGlassWallpaperUploadTooLarge: 'Il-fajl tal-isfond jista’ jkun sa 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Uża fajl JPG jew PNG sa 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'L-isfond ma setax jiġi ssejvjat. Il-localStorage tal-brawżer jista’ jkun mimli.',
			info: {
				frostedGlassWallpaper:
					'L-isfond Frosted Glass magħżul. L-isfondi integrati jitqassmu ma’ llampart; id-data tal-isfond personalizzat tinħażen biss fil-localStorage ta’ dan il-brawżer.',
				frostedGlassMilkiness: 'Aġġusta l-uċuħ tal-ħġieġ. 50% iżomm il-materjal oriġinali.',
				frostedGlassOpaque:
					'Uża uċuħ opaki lewn il-kulur tal-aċċent u żomm il-livell tal-effett ħalibi tal-ħġieġ.'
			}
		}
	},
	hu: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Háttérkép',
			frostedGlassWallpaperDescription:
				'Válassz az 5 beépített háttérkép közül, vagy használj egy ebben a böngészőben helyben tárolt egyéni háttérképet.',
			frostedGlassMilkiness: 'Tejüveghatás erőssége',
			frostedGlassOpaque: 'Átlátszóság kikapcsolása',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Egyéni háttérkép',
			frostedGlassWallpaperUpload: 'JPG/PNG feltöltése',
			frostedGlassWallpaperAdd: 'Hozzáadás',
			frostedGlassWallpaperReplace: 'Csere',
			frostedGlassWallpaperRemove: 'Eltávolítás',
			frostedGlassWallpaperUserSaved: 'Egyéni háttérkép mentve.',
			frostedGlassWallpaperSaveError:
				'Nem sikerült menteni a háttérképet. Lehet, hogy az előző egyéni kép törlődött. A többi módosítás nem lett mentve. Töltsd fel újra a képet, majd próbáld újra.',
			frostedGlassWallpaperUserRemoved: 'Egyéni háttérkép eltávolítva.',
			frostedGlassWallpaperUploadInvalidType: 'Válassz JPG- vagy PNG-fájlt.',
			frostedGlassWallpaperUploadTooLarge: 'A háttérképfájl mérete legfeljebb 1,5 MiB lehet.',
			frostedGlassWallpaperUploadRequirements:
				'Legfeljebb 1,5 MiB méretű JPG- vagy PNG-fájlt használj.',
			frostedGlassWallpaperUploadReadError:
				'Nem sikerült menteni a háttérképet. Lehet, hogy a böngésző localStorage tárhelye megtelt.',
			info: {
				frostedGlassWallpaper:
					'A kiválasztott Frosted Glass háttérkép. A beépített háttérképek a llampart részei; az egyéni háttérkép adatait csak ennek a böngészőnek a localStorage tárhelye tárolja.',
				frostedGlassMilkiness:
					'Az üvegfelületek megjelenését szabályozza. Az 50% megőrzi az eredeti anyaghatást.',
				frostedGlassOpaque:
					'Átlátszatlan, kiemelőszínnel árnyalt felületek használata a tejüveghatás erősségének megőrzésével.'
			}
		}
	},
	bg: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Тапет',
			frostedGlassWallpaperDescription:
				'Изберете един от 5-те вградени тапета или персонализиран тапет, съхраняван локално в този браузър.',
			frostedGlassMilkiness: 'Млечен ефект на стъклото',
			frostedGlassOpaque: 'Изключване на прозрачността',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Потребителски тапет',
			frostedGlassWallpaperUpload: 'Качване на JPG/PNG',
			frostedGlassWallpaperAdd: 'Добавяне',
			frostedGlassWallpaperReplace: 'Замяна',
			frostedGlassWallpaperRemove: 'Премахване',
			frostedGlassWallpaperUserSaved: 'Потребителският тапет е запазен.',
			frostedGlassWallpaperSaveError:
				'Тапетът не можа да бъде запазен. Предишното персонализирано изображение може да е било премахнато. Другите промени не са запазени. Качете изображението отново и опитайте пак.',
			frostedGlassWallpaperUserRemoved: 'Потребителският тапет е премахнат.',
			frostedGlassWallpaperUploadInvalidType: 'Изберете JPG или PNG файл.',
			frostedGlassWallpaperUploadTooLarge: 'Файлът за тапет може да бъде до 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Използвайте JPG или PNG файл до 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Тапетът не можа да бъде запазен. Възможно е localStorage на браузъра да е запълнено.',
			info: {
				frostedGlassWallpaper:
					'Избраният тапет за Frosted Glass. Вградените тапети се доставят с llampart; данните за персонализирания тапет се съхраняват само в localStorage на този браузър.',
				frostedGlassMilkiness:
					'Настройване на стъклените повърхности. При 50% се запазва оригиналният материал.',
				frostedGlassOpaque:
					'Използване на непрозрачни повърхности, оцветени с акцентния цвят, като се запазва настройката за млечния ефект на стъклото.'
			}
		}
	},
	csb: {
		settings: {
			themeFrostedGlass: 'Frosted Glass',
			groupFrostedGlassWallpaper: 'Tapéta',
			frostedGlassWallpaperDescription:
				'Wëbierzë jedną z 5 wbùdowónëch tapétów abò swòjã tapétã zapisóną môlowò w tim przezérnikù.',
			frostedGlassMilkiness: 'Mlécznosc szkła',
			frostedGlassOpaque: 'Wëłączë przezérnosc',
			frostedGlassWallpaper01: 'Frosted Glass 01',
			frostedGlassWallpaper02: 'Frosted Glass 02',
			frostedGlassWallpaper03: 'Frosted Glass 03',
			frostedGlassWallpaper04: 'Frosted Glass 04',
			frostedGlassWallpaper05: 'Frosted Glass 05',
			frostedGlassWallpaperUser: 'Tapéta ùżëtkòwnika',
			frostedGlassWallpaperUpload: 'Wladëjë JPG/PNG',
			frostedGlassWallpaperAdd: 'Dodôj',
			frostedGlassWallpaperReplace: 'Wladëjë jinszą',
			frostedGlassWallpaperRemove: 'Ùsëń',
			frostedGlassWallpaperUserSaved: 'Tapéta ùżëtkòwnika zapisónô.',
			frostedGlassWallpaperSaveError:
				'Nie dało sã zapisac tapétë. Przédny swój òbrôzk mógł òstac ùsëniãti. Jinszé zmianë nie òstałë zapisóné. Wladëjë òbrôzk znowa ë spróbùjë jesz rôz.',
			frostedGlassWallpaperUserRemoved: 'Tapéta ùżëtkòwnika ùsëniãtô.',
			frostedGlassWallpaperUploadInvalidType: 'Wëbierzë lopk JPG abò PNG.',
			frostedGlassWallpaperUploadTooLarge: 'Lopk tapétë mòże miec co nôwicy 1,5 MiB.',
			frostedGlassWallpaperUploadRequirements: 'Ùżëjë lopka JPG abò PNG do 1,5 MiB.',
			frostedGlassWallpaperUploadReadError:
				'Nie dało sã zapisac tapétë. Pamiãc localStorage przezérnika mòże bëc fùl.',
			info: {
				frostedGlassWallpaper:
					'Wëbrónô tapéta Frosted Glass. Wbùdowóné tapétë są dostôwióné z llampart; pòdôwczi swòji tapétë są trzëmóné blós w localStorage negò przezérnika.',
				frostedGlassMilkiness: 'Dopasowùje pòwierzchnie szkła. 50% zatrzëmùje òriginalny materiał.',
				frostedGlassOpaque:
					'Ùżëwôj nieprzezérnëch pòwierzchniów z akcentowim zabarwieniém ë spamiãtôj mlécznosc szkła.'
			}
		}
	}
};
