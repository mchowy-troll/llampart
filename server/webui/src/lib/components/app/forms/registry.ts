import { defineRegistry } from '@json-render/svelte';
import { formCatalog } from '$lib/forms/form-catalog';
import Container from './Container.svelte';
import Group from './Group.svelte';
import Heading from './Heading.svelte';
import Description from './Description.svelte';
import TextInput from './TextInput.svelte';
import Textarea from './Textarea.svelte';
import Checkbox from './Checkbox.svelte';
import CheckboxGroup from './CheckboxGroup.svelte';
import RadioGroup from './RadioGroup.svelte';
import Select from './Select.svelte';
import Slider from './Slider.svelte';
import Number from './Number.svelte';
import Date from './Date.svelte';
import SubmitButton from './SubmitButton.svelte';

export const { registry } = defineRegistry(formCatalog, {
	components: {
		Container,
		Group,
		Heading,
		Description,
		TextInput,
		Textarea,
		Checkbox,
		CheckboxGroup,
		RadioGroup,
		Select,
		Slider,
		Number,
		Date,
		SubmitButton
	}
});
