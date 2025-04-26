FROM public.ecr.aws/lambda/python:3.12

COPY ./.env ./asset/requirements.txt ${LAMBDA_TASK_ROOT}

RUN pip install -r requirements.txt

COPY ./asset/consumer.py ${LAMBDA_TASK_ROOT}

CMD [ "consumer.handle" ]
