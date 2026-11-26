/*
 * NexIA · Material de ejemplo.
 * Texto de muestra para probar la plataforma sin subir un archivo propio.
 * Pasa por el mismo analizador que cualquier documento del estudiante.
 */
(function (root) {
  'use strict';

  const NexIA = (root.NexIA = root.NexIA || {});

  const text = [
    '# Programación orientada a objetos',
    '',
    'La programación orientada a objetos es un paradigma que organiza el software alrededor de objetos que combinan datos y comportamiento. En lugar de escribir una larga lista de instrucciones, el programador modela las entidades del problema y la forma en que colaboran entre sí. Este enfoque facilita el mantenimiento del código, porque cada parte del sistema tiene una responsabilidad clara.',
    '',
    '## Clases y objetos',
    '',
    'Una clase es una plantilla que describe las características y las acciones que comparten un grupo de objetos. Las características se llaman atributos y las acciones se llaman métodos. Por ejemplo, la clase Vehiculo puede tener los atributos marca y velocidad, y el método moverse.',
    '',
    'Un objeto es una instancia concreta de una clase. Cada objeto guarda sus propios valores en los atributos, pero todos los objetos de la misma clase comparten los mismos métodos. Crear un objeto a partir de una clase se conoce como instanciar la clase.',
    '',
    '```python',
    'class Vehiculo:',
    '    def __init__(self, marca):',
    '        self.marca = marca',
    '        self.velocidad = 0',
    '',
    '    def moverse(self):',
    '        return "En movimiento"',
    '',
    'auto = Vehiculo("Toyota")',
    '```',
    '',
    'El constructor es un método especial que se ejecuta al crear el objeto y que prepara el estado inicial de sus atributos. En Python el constructor se llama __init__ y recibe como primer parámetro la referencia al propio objeto.',
    '',
    '## Herencia',
    '',
    'La herencia es un mecanismo que permite crear una clase nueva a partir de una clase existente. La clase existente se llama clase base y la clase nueva se llama clase hija. La clase hija reutiliza los atributos y los métodos de la clase base, y además puede añadir su propio comportamiento.',
    '',
    'Gracias a la herencia no es necesario copiar y pegar código. Si se corrige un error en la clase base, todas las clases hijas reciben la mejora de forma automática. Por ejemplo, las clases Auto y Moto pueden heredar de Vehiculo y aprovechar el método moverse sin volver a escribirlo.',
    '',
    '```python',
    'class Auto(Vehiculo):',
    '    pass',
    '',
    'class Moto(Vehiculo):',
    '    def moverse(self):',
    '        return "Avanza en dos ruedas"',
    '```',
    '',
    'La herencia expresa una relación del tipo «es un»: un auto es un vehículo. Cuando esa relación no se cumple, conviene usar la composición, que consiste en construir un objeto a partir de otros objetos más pequeños.',
    '',
    '## Polimorfismo',
    '',
    'El polimorfismo es la capacidad de que distintas clases respondan al mismo método con un comportamiento propio. El código que llama al método no necesita saber qué clase concreta tiene delante: solo confía en que el objeto sabe responder.',
    '',
    'La sobrescritura de métodos es la técnica que hace posible el polimorfismo. Una clase hija sobrescribe un método cuando define su propia versión de un método heredado de la clase base. En el ejemplo anterior, la clase Moto sobrescribe el método moverse.',
    '',
    '```python',
    'vehiculos = [Auto("Kia"), Moto("Honda")]',
    'for vehiculo in vehiculos:',
    '    print(vehiculo.moverse())',
    '```',
    '',
    'El polimorfismo reduce las condiciones repetidas en el programa. En vez de preguntar por el tipo de cada objeto con una cadena de comparaciones, se llama al mismo método y cada clase decide cómo actuar. Así resulta más sencillo incorporar nuevas clases sin modificar el código que ya funciona.',
    '',
    '## Encapsulamiento',
    '',
    'El encapsulamiento consiste en ocultar los detalles internos de un objeto y exponer solo las operaciones necesarias para usarlo. Los atributos privados solo pueden modificarse a través de los métodos de la propia clase, lo que protege el estado del objeto frente a cambios incorrectos.',
    '',
    'Una interfaz pública bien definida permite cambiar la implementación interna sin afectar al resto del sistema. Por ejemplo, una clase CuentaBancaria puede validar cada retiro dentro de un método, en lugar de permitir que cualquier parte del programa cambie el saldo directamente.',
    '',
    '## Aplicaciones prácticas',
    '',
    'La programación orientada a objetos se utiliza en el desarrollo de aplicaciones de escritorio, sistemas web, videojuegos y aplicaciones móviles. En un sistema de transporte, por ejemplo, la clase base Vehiculo reúne los atributos comunes, mientras que las clases hijas representan cada medio de transporte.',
    '',
    'Para diseñar un buen modelo de clases conviene seguir tres pasos:',
    '',
    '- Identificar las entidades del problema y sus atributos.',
    '- Agrupar el comportamiento común en una clase base.',
    '- Especializar las clases hijas mediante herencia y polimorfismo.',
    '',
    'Un diseño orientado a objetos bien planteado produce código reutilizable y fácil de ampliar. La herencia evita la duplicación, el polimorfismo simplifica las decisiones y el encapsulamiento protege los datos.'
  ].join('\n');

  NexIA.sample = {
    title: 'Programación orientada a objetos',
    fileName: 'Programación orientada a objetos (ejemplo).md',
    text
  };
})(typeof window !== 'undefined' ? window : globalThis);
