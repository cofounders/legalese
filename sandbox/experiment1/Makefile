%.json: %.yaml
	perl -MJSON -MYAML=LoadFile -le 'print JSON->new->pretty->encode(LoadFile shift)' $< > $@

all: english.html

HANDLEBARS=handlebars
HANDLEBARS=../../src/bin/hb

.SECONDARY:

%.mdh: %.mustache main.json
	$(HANDLEBARS) main.json < $< > $@

%.mdm: %.mustache main.yaml
	mustache main.yaml $< > $@

%.html: %.mdh
	markdown $< > $@

clean: 
	rm -f *.html *.md? *.txt *.json *~
